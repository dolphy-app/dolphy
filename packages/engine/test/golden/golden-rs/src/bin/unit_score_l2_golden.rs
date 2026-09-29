//! L2 golden generator of the scoring aggregates: `get_unit_score` of every unit (exercise ->
//! lesson -> course) of a library after a scripted attempt log, computed by the REAL Trane
//! v0.34.1 (`Trane::score_exercise` -> practice stats + reward propagation -> `UnitScorer`).
//!
//! Libraries are given on the command line (`name,dir,treeSha256`); the directories are only read:
//! every scenario runs on a private copy (Trane writes `.trane` into the library root). A scenario
//! is scripted from the SHAPE of the library (lessons, `encompasses`, `superseded_by`) read from
//! Trane itself, so the same templates work on any library; templates whose structure the library
//! lacks are skipped.
//!
//! Run of a scenario:
//!   1. open Trane, add the blacklist, replay the attempts OLDEST FIRST in ONE process (the
//!      in-memory reward cache of `LocalPracticeRewards` is alive, exactly the single-process
//!      history the deterministic TS dedup reproduces; `engine-ts.md` §12.6);
//!   2. if an exercise has >= 3 attempts, delete `.trane/practice_deltas.db`: the TS port drops
//!      the deltas by design (`unit-scorer.ts`), and Rust applies them from the third attempt
//!      (>= 2 deltas). Scenarios with <= 2 attempts per exercise run on unmodified Trane;
//!   3. reopen Trane on the same directory (fresh caches), pin the clock to `NOW_MS` and read:
//!      `powerLaw`  `get_unit_score` of every unit (`null` = `None`); lesson and course averages
//!                  are canonicalised, see `canonical_means`;
//!      `rewards`   `get_rewards(unit, 20)` of every lesson/course that has rewards
//!                  ([value, weight, timestamp_s], newest first);
//!      `fsrs`      exercise score of the FSRS adapter (`fsrs_scorer.rs`, Hybrid, runner map) +
//!                  the real reward scorer over the real reward store, for every attempted
//!                  exercise (Trane cannot host the adapter: `UnitScorer` is private).
//!
//! Output (JSON Lines, keys sorted by serde_json, LF): the header
//! `{"libraries","nowMs","seed","trane"}`, then one case per line
//! `{"attempts","blacklist","deltas","expect","id","library"}`.
//!
//! Usage: `cargo run --release --offline --bin unit_score_l2_golden -- <out.jsonl>
//! <name,dir,treeSha256>...` (normally through `test/golden/regenerate-unit-score-l2.ts`).

#[allow(dead_code)]
#[path = "../fsrs_scorer.rs"]
mod fsrs_scorer;
#[allow(dead_code)]
#[path = "../scheduler_common.rs"]
mod scheduler_common;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::{Context, Result, bail, ensure};
use fsrs_scorer::{FsrsScorer, RatingMap, Variant};
use scheduler_common::{DAY_MS, HOUR_MS, NOW_MS, Rng, trane_json, write_jsonl};
use serde_json::{Map, Value, json};
use trane::Trane;
use trane::blacklist::Blacklist;
use trane::course_library::CourseLibrary;
use trane::data::{ExerciseTrial, MasteryScore, SchedulerOptions};
use trane::exercise_scorer::ExerciseScorer;
use trane::graph::UnitGraph;
use trane::practice_rewards::PracticeRewards;
use trane::practice_stats::PracticeStats;
use trane::reward_scorer::{MIN_TRIALS_FOR_REWARD, RewardScorer, WeightedRewardScorer};
use trane::scheduler::ExerciseScheduler;
use ustr::Ustr;

const SEED: u64 = 0x5EED_1259_2026_0930;
const NOW_S: i64 = NOW_MS / 1000;
const MINUTE_MS: i64 = 60_000;
/// Rewards kept per unit in the store (`OFFSET 20`).
const REWARDS_STORED: u32 = 20;
/// How far Trane's average may be from the id-ordered mean (f32 summation order only).
const MEAN_SNAP: f32 = 1e-5;

#[derive(Clone)]
struct Attempt {
    exercise: String,
    score: u8,
    ago_ms: i64,
}

fn att(exercise: &str, score: u8, ago_ms: i64) -> Attempt {
    Attempt { exercise: exercise.into(), score, ago_ms }
}

struct Scenario {
    name: &'static str,
    blacklist: Vec<String>,
    attempts: Vec<Attempt>,
}

struct Lesson {
    id: String,
    course: String,
    exercises: Vec<String>,
}

/// Structure of a library as Trane reports it; every list is sorted by id.
struct Shape {
    courses: Vec<String>,
    lessons: Vec<Lesson>,
    encompasses: BTreeMap<String, Vec<(String, f32)>>,
    encompassed_by: BTreeMap<String, Vec<(String, f32)>>,
    superseded_by: BTreeMap<String, Vec<String>>,
}

static COPY_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// A private, removed-on-drop copy of a library directory.
struct Workdir {
    root: PathBuf,
}

impl Workdir {
    fn new(source: &Path) -> Result<Self> {
        let root = std::env::temp_dir().join(format!(
            "unit-score-l2-{}-{}",
            std::process::id(),
            COPY_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        copy_dir(source, &root)?;
        ensure!(!root.join(".trane").exists(), "library {} has a .trane directory", source.display());
        Ok(Self { root })
    }

    fn open(&self, now_s: i64) -> Result<Trane> {
        let mut trane = Trane::new_local(&self.root, &self.root)?;
        trane.override_current_timestamp(Some(now_s));
        Ok(trane)
    }
}

impl Drop for Workdir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn sorted_ids(ids: impl IntoIterator<Item = Ustr>) -> Vec<String> {
    let mut ids: Vec<String> = ids.into_iter().map(|id| id.to_string()).collect();
    ids.sort();
    ids
}

fn sorted_edges(edges: Option<Vec<(Ustr, f32)>>) -> Vec<(String, f32)> {
    let mut edges: Vec<(String, f32)> =
        edges.unwrap_or_default().into_iter().map(|(id, w)| (id.to_string(), w)).collect();
    edges.sort_by(|a, b| a.0.cmp(&b.0));
    edges
}

fn read_shape(trane: &Trane) -> Shape {
    let courses = sorted_ids(trane.get_course_ids());
    let mut lessons = Vec::new();
    let mut encompasses = BTreeMap::new();
    let mut encompassed_by = BTreeMap::new();
    let mut superseded_by = BTreeMap::new();
    let mut record = |unit: &str| {
        let id = Ustr::from(unit);
        let out = sorted_edges(trane.get_encompasses(id));
        if !out.is_empty() {
            encompasses.insert(unit.to_string(), out);
        }
        let inc = sorted_edges(trane.get_encompassed_by(id));
        if !inc.is_empty() {
            encompassed_by.insert(unit.to_string(), inc);
        }
        let sup = trane.get_superseded_by(id).map(|set| sorted_ids(set.iter().copied()));
        if let Some(sup) = sup.filter(|list| !list.is_empty()) {
            superseded_by.insert(unit.to_string(), sup);
        }
    };
    for course in &courses {
        record(course);
        let ids = trane.get_lesson_ids(Ustr::from(course)).unwrap_or_default();
        for lesson in sorted_ids(ids) {
            record(&lesson);
            let exercises = trane.get_exercise_ids(Ustr::from(&lesson)).unwrap_or_default();
            lessons.push(Lesson {
                id: lesson,
                course: course.clone(),
                exercises: sorted_ids(exercises),
            });
        }
    }
    lessons.sort_by(|a, b| a.id.cmp(&b.id));
    Shape { courses, lessons, encompasses, encompassed_by, superseded_by }
}

impl Shape {
    fn lesson(&self, id: &str) -> Option<&Lesson> {
        self.lessons.iter().find(|l| l.id == id && !l.exercises.is_empty())
    }

    fn practicable(&self) -> Vec<&Lesson> {
        self.lessons.iter().filter(|l| !l.exercises.is_empty()).collect()
    }

    fn exercise_count(&self) -> usize {
        self.lessons.iter().map(|l| l.exercises.len()).sum()
    }

    /// Lesson with the most lesson targets in `edges`, and its first practicable target.
    fn most_connected(&self, edges: &BTreeMap<String, Vec<(String, f32)>>) -> Option<(&Lesson, &Lesson)> {
        let mut best: Option<(usize, &Lesson, &Lesson)> = None;
        for lesson in self.practicable() {
            let targets: Vec<&Lesson> = edges
                .get(&lesson.id)
                .map(|list| list.iter().filter_map(|(id, _)| self.lesson(id)).collect())
                .unwrap_or_default();
            if let Some(first) = targets.first()
                && best.is_none_or(|(n, _, _)| targets.len() > n)
            {
                best = Some((targets.len(), lesson, first));
            }
        }
        best.map(|(_, a, b)| (a, b))
    }

    /// Exercises of a course, lesson order.
    fn course_exercises(&self, course: &str) -> Vec<&String> {
        self.lessons.iter().filter(|l| l.course == course).flat_map(|l| &l.exercises).collect()
    }

    /// A small course with exactly one superseding course (both have exercises).
    fn superseded_course_pair(&self) -> Option<(&String, &String)> {
        self.courses.iter().find_map(|course| {
            let by = self.superseded_by.get(course)?;
            let superseding = self.courses.iter().find(|c| by.len() == 1 && **c == by[0])?;
            let (a, b) = (self.course_exercises(course), self.course_exercises(superseding));
            (!a.is_empty() && !b.is_empty() && a.len() + b.len() <= 14).then_some((course, superseding))
        })
    }

    /// A lesson encompassed by at least `min` practicable lessons (`encompassed_by`, id order).
    fn fan_in(&self, min: usize) -> Option<(&Lesson, Vec<&Lesson>)> {
        self.practicable().into_iter().find_map(|hub| {
            let sources: Vec<&Lesson> = self
                .encompassed_by
                .get(&hub.id)
                .map(|list| list.iter().filter_map(|(id, _)| self.lesson(id)).collect())
                .unwrap_or_default();
            (sources.len() >= min).then_some((hub, sources))
        })
    }

    /// A lesson with at least two superseding lessons, all practicable.
    fn superseded_multi(&self) -> Option<(&Lesson, Vec<&Lesson>)> {
        self.practicable().into_iter().find_map(|lesson| {
            let by = self.superseded_by.get(&lesson.id)?;
            let superseding: Vec<&Lesson> = by.iter().filter_map(|id| self.lesson(id)).collect();
            (by.len() >= 2 && superseding.len() == by.len()).then_some((lesson, superseding))
        })
    }

    /// A lesson with exactly one superseding lesson; both have exercises.
    fn superseded_pair(&self) -> Option<(&Lesson, &Lesson)> {
        self.practicable().into_iter().find_map(|lesson| {
            let by = self.superseded_by.get(&lesson.id)?;
            if by.len() != 1 {
                return None;
            }
            self.lesson(&by[0]).map(|superseding| (lesson, superseding))
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Scenario templates.

fn rounds(lesson: &Lesson, limit: usize, plan: &[(u8, i64)]) -> Vec<Attempt> {
    let mut out = Vec::new();
    for (score, ago_ms) in plan {
        for (i, exercise) in lesson.exercises.iter().take(limit).enumerate() {
            out.push(att(exercise, *score, ago_ms + i as i64 * 7 * MINUTE_MS));
        }
    }
    out
}

/// Three attempts per exercise, the last one `last_ago_ms` ago (even exercises 12 hours inside the
/// week `apply_reward` looks at, odd ones 12 hours outside it), grades `grades` oldest first.
fn week_edge(lesson: &Lesson, grades: [u8; 3]) -> Vec<Attempt> {
    let mut out = Vec::new();
    for (i, exercise) in lesson.exercises.iter().take(4).enumerate() {
        let last = if i % 2 == 0 { 7 * DAY_MS - 12 * HOUR_MS } else { 7 * DAY_MS + 12 * HOUR_MS };
        for (k, grade) in grades.iter().enumerate() {
            out.push(att(exercise, *grade, last + (2 - k as i64) * 5 * DAY_MS + i as i64 * 3 * MINUTE_MS));
        }
    }
    out
}

fn scenarios(shape: &Shape, rng: &mut Rng) -> Vec<Scenario> {
    let mut out = vec![Scenario { name: "empty", blacklist: vec![], attempts: vec![] }];
    let lessons = shape.practicable();
    if lessons.is_empty() {
        return out;
    }
    let first = lessons[0];

    out.push(Scenario {
        name: "single",
        blacklist: vec![],
        attempts: vec![att(&first.exercises[0], 4, 2 * DAY_MS)],
    });

    let mut mixed = Vec::new();
    let mut counter = 0u8;
    for lesson in lessons.iter().take(12) {
        for exercise in lesson.exercises.iter().take(3) {
            let ago = rng.range(HOUR_MS as u64 / 1000, 60 * 86_400) as i64 * 1000;
            mixed.push(att(exercise, 1 + (counter * 7 + 3) % 5, ago));
            counter += 1;
        }
    }
    out.push(Scenario { name: "mixed-grades", blacklist: vec![], attempts: mixed.clone() });

    // Repeats on several days: the exercises reach the 3 trials at which rewards apply.
    let mut repeats = Vec::new();
    let picks = lessons.len().min(6);
    for k in 0..picks {
        let lesson = lessons[k * lessons.len() / picks];
        let exercise = &lesson.exercises[0];
        let count = 3 + rng.below(4) as i64;
        let mut ago = rng.range(1, 3) as i64 * DAY_MS + rng.range(0, 40_000) as i64 * 1000;
        for _ in 0..count {
            repeats.push(att(exercise, 1 + rng.below(5) as u8, ago));
            ago += rng.range(1, 20) as i64 * DAY_MS + rng.range(0, 40_000) as i64 * 1000;
        }
    }
    out.push(Scenario { name: "repeats-days", blacklist: vec![], attempts: repeats });

    if let Some((source, target)) = shape.most_connected(&shape.encompasses) {
        // Good grades on a lesson that encompasses `target` reward `target` (down the graph);
        // `target` exercises with 3 trials pick the reward up. Old last trials (>= 7 days) always
        // accept it, recent ones only with a decent average.
        let mut attempts = rounds(source, 6, &[(5, 30 * DAY_MS), (5, 12 * DAY_MS), (5, 3 * DAY_MS)]);
        attempts.extend(rounds(target, 4, &[(3, 20 * DAY_MS), (4, 6 * DAY_MS), (5, DAY_MS)]));
        if let Some(other) = lessons.iter().find(|l| l.id != source.id && l.id != target.id) {
            attempts.extend(rounds(other, 2, &[(2, 15 * DAY_MS), (3, 9 * DAY_MS), (2, 8 * DAY_MS)]));
        }
        out.push(Scenario { name: "encompass-reward", blacklist: vec![], attempts });

        // The same target, but the last trials are recent and weak: positive rewards are refused.
        let mut attempts = rounds(source, 6, &[(5, 30 * DAY_MS), (5, 10 * DAY_MS), (5, 2 * DAY_MS)]);
        attempts.extend(rounds(target, 4, &[(2, 5 * DAY_MS), (2, 3 * DAY_MS), (1, DAY_MS)]));
        out.push(Scenario { name: "reward-refused", blacklist: vec![], attempts });

        // Positive rewards and a poor average: refused while the last trial is younger than 7 days,
        // accepted once it is older (the exercises alternate 12 hours either side of the week).
        let mut attempts = rounds(source, 6, &[(5, 30 * DAY_MS), (5, 20 * DAY_MS), (5, 16 * DAY_MS)]);
        attempts.extend(week_edge(target, [2, 3, 2]));
        out.push(Scenario { name: "week-edge-positive", blacklist: vec![], attempts });

        // Many attempts of one exercise (window of trials) and many same-day rewards (dedup).
        let mut attempts = Vec::new();
        let dense = &source.exercises[0];
        for k in 0..24i64 {
            let grade = [5, 5, 3, 1, 4, 5, 2][(k % 7) as usize];
            attempts.push(att(dense, grade, 120 * DAY_MS - k * 5 * DAY_MS + k * 61_000));
        }
        for (i, exercise) in source.exercises.iter().enumerate().skip(1).take(5) {
            for j in 0..3i64 {
                attempts.push(att(exercise, 5, 2 * DAY_MS + i as i64 * 20 * MINUTE_MS + j * 3 * HOUR_MS));
            }
        }
        attempts.extend(rounds(target, 4, &[(4, 9 * DAY_MS), (3, 8 * DAY_MS), (5, 7 * DAY_MS + HOUR_MS)]));
        out.push(Scenario { name: "dense-history", blacklist: vec![], attempts });

        // Several attempts of the same exercises inside a few hours.
        let mut attempts = Vec::new();
        for (i, exercise) in source.exercises.iter().take(5).enumerate() {
            for j in 0..4i64 {
                let grade = 1 + ((i as i64 * 3 + j * 2) % 5) as u8;
                attempts.push(att(exercise, grade, 6 * HOUR_MS - j * 50 * MINUTE_MS + i as i64 * 3 * MINUTE_MS));
            }
        }
        out.push(Scenario { name: "same-day", blacklist: vec![], attempts });
    }

    if let Some((hub, sources)) = shape.fan_in(11) {
        // One good attempt per source inside 2 hours: the hub gets a distinct reward from each
        // (different edge weights), 11+ within one day. Then two repeats: the source whose reward
        // is the 10th newest (inside the dedup window of 10) and the one that is the 11th (outside).
        let n = sources.len();
        let mut attempts = Vec::new();
        for (k, source) in sources.iter().enumerate() {
            attempts.push(att(&source.exercises[0], 5, 6 * HOUR_MS - k as i64 * 10 * MINUTE_MS));
        }
        for (j, k) in [n - 10, n - 11].into_iter().enumerate() {
            attempts.push(att(&sources[k].exercises[0], 5, 3 * HOUR_MS - j as i64 * 10 * MINUTE_MS));
        }
        attempts.extend(rounds(hub, 2, &[(3, 30 * DAY_MS), (4, 20 * DAY_MS), (3, 10 * DAY_MS)]));
        out.push(Scenario { name: "fan-in-dedup", blacklist: vec![], attempts });
    }

    if let Some((weak, strong)) = shape.most_connected(&shape.encompassed_by) {
        // Bad grades on `weak` penalise the lessons that encompass it (up the graph).
        let mut attempts = rounds(weak, 6, &[(1, 28 * DAY_MS), (1, 14 * DAY_MS), (2, 11 * DAY_MS)]);
        attempts.extend(rounds(strong, 4, &[(4, 25 * DAY_MS), (5, 8 * DAY_MS), (4, 2 * DAY_MS)]));
        out.push(Scenario { name: "encompass-penalty", blacklist: vec![], attempts });

        // Negative rewards and a good average: the same week boundary.
        let mut attempts = rounds(weak, 6, &[(1, 30 * DAY_MS), (1, 20 * DAY_MS), (1, 16 * DAY_MS)]);
        attempts.extend(week_edge(strong, [5, 4, 5]));
        out.push(Scenario { name: "week-edge-negative", blacklist: vec![], attempts });
    }

    if let Some((superseded, superseding)) = shape.superseded_pair() {
        for (name, grade) in [("superseded-mastered", 5u8), ("superseded-weak", 2u8)] {
            let mut attempts = rounds(superseded, 6, &[(4, 12 * DAY_MS), (4, 5 * DAY_MS)]);
            attempts.extend(rounds(superseding, 6, &[(grade, 40 * HOUR_MS), (grade, 20 * HOUR_MS), (grade, 2 * HOUR_MS)]));
            out.push(Scenario { name, blacklist: vec![], attempts });
        }
    }

    if let Some((superseded, superseding)) = shape.superseded_multi() {
        // Superseded only when EVERY superseding lesson is mastered.
        for (name, strong) in [("superseded-all-mastered", usize::MAX), ("superseded-partial", 1)] {
            let mut attempts = rounds(superseded, 6, &[(4, 12 * DAY_MS), (4, 5 * DAY_MS)]);
            for (k, lesson) in superseding.iter().enumerate() {
                let grade = if k < strong { 5 } else { 2 };
                attempts.extend(rounds(lesson, 6, &[(grade, 40 * HOUR_MS), (grade, 20 * HOUR_MS), (grade, 2 * HOUR_MS)]));
            }
            out.push(Scenario { name, blacklist: vec![], attempts });
        }
    }

    if let Some((superseded, superseding)) = shape.superseded_course_pair() {
        for (name, grade) in [("superseded-course-mastered", 5u8), ("superseded-course-weak", 2u8)] {
            let mut attempts = Vec::new();
            for (i, exercise) in shape.course_exercises(superseded).into_iter().enumerate() {
                for (score, ago_ms) in [(4, 12 * DAY_MS), (4, 5 * DAY_MS)] {
                    attempts.push(att(exercise, score, ago_ms + i as i64 * 7 * MINUTE_MS));
                }
            }
            for (i, exercise) in shape.course_exercises(superseding).into_iter().enumerate() {
                for ago_ms in [40 * HOUR_MS, 20 * HOUR_MS, 2 * HOUR_MS] {
                    attempts.push(att(exercise, grade, ago_ms + i as i64 * 7 * MINUTE_MS));
                }
            }
            out.push(Scenario { name, blacklist: vec![], attempts });
        }
    }

    // Blacklisted lesson, exercise and (with several courses) course among practised units.
    let mut blacklist = vec![lessons[lessons.len().min(2) - 1].id.clone()];
    if let Some(lesson) = lessons.iter().find(|l| l.exercises.len() >= 2 && l.id != blacklist[0]) {
        blacklist.push(lesson.exercises[1].clone());
    }
    if shape.courses.len() >= 2 {
        blacklist.push(shape.courses[shape.courses.len() - 1].clone());
    }
    let mut attempts = mixed;
    for lesson in lessons.iter().take(2) {
        attempts.extend(rounds(lesson, 2, &[(4, 20 * DAY_MS + 3 * HOUR_MS), (5, 9 * DAY_MS), (3, 4 * DAY_MS)]));
    }
    out.push(Scenario { name: "blacklist", blacklist, attempts });
    out
}

/// Every attempt gets its own second (the engine orders by time and orders ties by 1 ms) and the
/// log is kept oldest first; at most 25 attempts per exercise.
fn finalize(mut attempts: Vec<Attempt>) -> Result<Vec<Attempt>> {
    let mut taken = BTreeSet::new();
    for attempt in &mut attempts {
        ensure!(attempt.ago_ms >= MINUTE_MS, "attempt too recent");
        while !taken.insert(attempt.ago_ms) {
            attempt.ago_ms += 1000;
        }
    }
    let mut per_exercise = BTreeMap::<&str, usize>::new();
    for attempt in &attempts {
        *per_exercise.entry(&attempt.exercise).or_default() += 1;
    }
    ensure!(per_exercise.values().all(|n| *n <= 25), "too many attempts on one exercise");
    attempts.sort_by_key(|a| std::cmp::Reverse(a.ago_ms));
    Ok(attempts)
}

// ---------------------------------------------------------------------------------------------
// Running against Trane.

fn mastery(score: u8) -> MasteryScore {
    match score {
        1 => MasteryScore::One,
        2 => MasteryScore::Two,
        3 => MasteryScore::Three,
        4 => MasteryScore::Four,
        5 => MasteryScore::Five,
        _ => unreachable!("scores are 1..=5"),
    }
}

/// f32 widened to f64 (exact); the same encoding as the other fixtures.
fn num(x: f32) -> Value {
    json!(f64::from(x))
}

fn optional(x: Option<f32>) -> Value {
    x.map_or(Value::Null, num)
}

/// Trane sums the scores of a lesson (course) in the iteration order of a `HashSet` keyed by a
/// precomputed `ustr` hash, and `ustr` seeds its hasher per process (`ahash::AHasher::default()`):
/// the same state gives lesson and course averages that differ by an f32 ulp or three from run to
/// run. So that the fixture is byte-identical on regeneration, an aggregate is written as the mean
/// of its members' scores summed in id order, after checking that Trane's own value is that mean
/// to within `MEAN_SNAP`; any other difference (a wrong member set, a blacklist or superseded
/// rule) is a real disagreement and stops the generator instead of being smoothed over. Exercise
/// scores, rewards and `None` are copied as Trane returned them.
fn canonical_means(trane: &Trane, shape: &Shape, raw: &BTreeMap<String, Option<f32>>) -> Result<Map<String, Value>> {
    let snap = |unit: &str, members: Vec<f32>| -> Result<Option<f32>> {
        let Some(Some(value)) = raw.get(unit).copied() else { return Ok(None) };
        ensure!(!members.is_empty(), "{unit} has a score but no member scores");
        let mean = members.iter().sum::<f32>() / members.len() as f32;
        ensure!((mean - value).abs() <= MEAN_SNAP, "{unit}: Trane {value} is not the mean {mean} of its members");
        Ok(Some(mean))
    };
    let mut canonical = raw.clone();
    for lesson in &shape.lessons {
        let mut members = Vec::new();
        for exercise in &lesson.exercises {
            if trane.blacklisted(Ustr::from(exercise))? {
                continue;
            }
            members.extend(raw.get(exercise).copied().flatten());
        }
        if let Some(mean) = snap(&lesson.id, members)? {
            canonical.insert(lesson.id.clone(), Some(mean));
        }
    }
    for course in &shape.courses {
        let members = shape
            .lessons
            .iter()
            .filter(|lesson| &lesson.course == course)
            .filter_map(|lesson| canonical.get(&lesson.id).copied().flatten())
            .collect();
        if let Some(mean) = snap(course, members)? {
            canonical.insert(course.clone(), Some(mean));
        }
    }
    Ok(canonical.into_iter().map(|(unit, score)| (unit, optional(score))).collect())
}

fn run(dir: &Path, shape: &Shape, scenario: &Scenario) -> Result<(Value, bool)> {
    let work = Workdir::new(dir)?;
    {
        let mut trane = work.open(NOW_S)?;
        for unit in &scenario.blacklist {
            trane.add_to_blacklist(Ustr::from(unit))?;
        }
        for attempt in &scenario.attempts {
            let timestamp = NOW_S - attempt.ago_ms / 1000;
            trane.override_current_timestamp(Some(timestamp));
            trane.score_exercise(Ustr::from(&attempt.exercise), mastery(attempt.score), timestamp)?;
        }
    }
    let mut per_exercise = BTreeMap::<&str, usize>::new();
    for attempt in &scenario.attempts {
        *per_exercise.entry(&attempt.exercise).or_default() += 1;
    }
    let deltas_cleared = per_exercise.values().any(|n| *n >= MIN_TRIALS_FOR_REWARD);
    if deltas_cleared {
        fs::remove_file(work.root.join(".trane").join("practice_deltas.db"))
            .context("remove practice_deltas.db")?;
    }

    let trane = work.open(NOW_S)?;
    let options = SchedulerOptions::default();
    let mut raw = BTreeMap::<String, Option<f32>>::new();
    let mut rewards = Map::new();
    let mut fsrs = Map::new();
    let scorer = FsrsScorer::with_defaults(RatingMap::RunnerMap, Variant::Hybrid);
    let reward_scorer = WeightedRewardScorer {};

    let mut score_unit = |unit: &str| -> Result<()> {
        raw.insert(unit.to_string(), trane.get_unit_score(Ustr::from(unit))?);
        Ok(())
    };
    let mut record_rewards = |unit: &str| -> Result<()> {
        let list = trane.get_rewards(Ustr::from(unit), REWARDS_STORED)?;
        if !list.is_empty() {
            let wire: Vec<Value> =
                list.iter().map(|r| json!([f64::from(r.value), f64::from(r.weight), r.timestamp])).collect();
            rewards.insert(unit.to_string(), Value::Array(wire));
        }
        Ok(())
    };
    for course in &shape.courses {
        score_unit(course)?;
        record_rewards(course)?;
    }
    for lesson in &shape.lessons {
        score_unit(&lesson.id)?;
        record_rewards(&lesson.id)?;
        for exercise in &lesson.exercises {
            score_unit(exercise)?;
            let id = Ustr::from(exercise);
            let trials: Vec<ExerciseTrial> = trane.get_scores(id, options.num_trials)?;
            if trials.is_empty() {
                continue;
            }
            let kind = trane
                .get_exercise_manifest(id)
                .map(|manifest| manifest.exercise_type.clone())
                .context("exercise manifest")?;
            let mut value = scorer.score(kind, &trials, &[], NOW_S)?.value;
            if trials.len() >= MIN_TRIALS_FOR_REWARD {
                let lesson_rewards = trane.get_rewards(Ustr::from(&lesson.id), options.num_rewards)?;
                let course_rewards = trane.get_rewards(Ustr::from(&lesson.course), options.num_rewards)?;
                let reward = reward_scorer.score_rewards(&course_rewards, &lesson_rewards, NOW_S)?;
                if reward_scorer.apply_reward(reward, &trials, NOW_S) {
                    value = (value + reward).clamp(0.0, 5.0);
                }
            }
            fsrs.insert(exercise.clone(), num(value));
        }
    }
    let power_law = canonical_means(&trane, shape, &raw)?;
    let expect = json!({"powerLaw": power_law, "rewards": rewards, "fsrs": fsrs});
    Ok((expect, deltas_cleared))
}

// ---------------------------------------------------------------------------------------------

struct Library {
    name: String,
    dir: PathBuf,
    tree_sha256: String,
}

fn parse_library(arg: &str) -> Result<Library> {
    let parts: Vec<&str> = arg.split(',').collect();
    ensure!(parts.len() == 3, "expected name,dir,treeSha256, got {arg}");
    Ok(Library { name: parts[0].into(), dir: PathBuf::from(parts[1]), tree_sha256: parts[2].into() })
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let Some(output) = args.next() else { bail!("usage: unit_score_l2_golden <out.jsonl> <name,dir,treeSha256>...") };
    let libraries = args.map(|arg| parse_library(&arg)).collect::<Result<Vec<_>>>()?;
    ensure!(!libraries.is_empty(), "no libraries");

    let mut rng = Rng(SEED);
    let mut header_libraries = Map::new();
    let mut cases = Vec::new();
    for library in &libraries {
        let shape = read_shape(&Workdir::new(&library.dir)?.open(NOW_S)?);
        header_libraries.insert(
            library.name.clone(),
            json!({
                "courses": shape.courses.len(),
                "lessons": shape.lessons.len(),
                "exercises": shape.exercise_count(),
                "treeSha256": library.tree_sha256,
            }),
        );
        for mut scenario in scenarios(&shape, &mut rng) {
            scenario.attempts = finalize(scenario.attempts)?;
            let (expect, deltas_cleared) = run(&library.dir, &shape, &scenario)?;
            eprintln!("{}/{}: {} attempts", library.name, scenario.name, scenario.attempts.len());
            cases.push(json!({
                "id": format!("{}/{}", library.name, scenario.name),
                "library": library.name,
                "blacklist": scenario.blacklist,
                "attempts": scenario.attempts.iter()
                    .map(|a| json!({"exerciseId": a.exercise, "score": a.score, "agoMs": a.ago_ms}))
                    .collect::<Vec<_>>(),
                "deltas": if deltas_cleared { "cleared" } else { "kept" },
                "expect": expect,
            }));
        }
    }
    let header = json!({
        "nowMs": NOW_MS,
        "seed": format!("{SEED:#X}"),
        "trane": trane_json(),
        "libraries": header_libraries,
    });
    write_jsonl(Path::new(&output), &header, &cases)?;
    eprintln!("wrote {} cases to {output}", cases.len());
    Ok(())
}
