//! Shared harness of the scheduler golden generators (`scheduler_l4_golden`,
//! `scheduler_frontier_golden`): scripted learner states on the REAL Trane v0.34.1.
//!
//! A state is a library (`TestCourse`/`TestLesson`), a blacklist and an attempt log. Batches are
//! drawn by the real `DepthFirstScheduler` with the learner state restored by REOPENING
//! `Trane::new_local` on the same working directory for every batch: the in-memory
//! `frequency_map`, the relearn pile and the success rate start fresh each time, so the batches
//! are identically distributed. The clock is pinned with `override_current_timestamp` after every
//! open. Times in Rust are seconds, in fixtures milliseconds (`NOW_MS`).
//!
//! Batch size: `Trane::set_scheduler_options` only replaces the options of `DepthFirstScheduler`
//! itself; `CandidateFilter`, `UnitScorer` and `RelearnPile` keep the copy of the options taken at
//! construction (`SchedulerData` is cloned by value). The final batch size therefore comes from
//! the user preferences (`scheduler.batch_size`) read at open time; `max_lessons_in_progress` is
//! read by the scheduler from its own options. `Worker` sets both, so one `SchedulerOptions`
//! value holds for the whole pipeline.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Map, Value, json};
use trane::Trane;
use trane::blacklist::Blacklist;
use trane::data::{MasteryScore, SchedulerOptions, SchedulerPreferences, UserPreferences};
use trane::scheduler::ExerciseScheduler;
use trane::test_utils::{TestCourse, TestId, TestLesson, init_simulation};
use ustr::Ustr;

/// Fixed "now" of every fixture (milliseconds). Batches are drawn at this instant.
pub const NOW_MS: i64 = 1_800_000_000_000;
pub const HOUR_MS: i64 = 3_600_000;
pub const DAY_MS: i64 = 24 * HOUR_MS;
/// Library size limit of the parity tests.
const MAX_EXERCISES: usize = 200;

#[derive(Clone)]
pub struct Lesson {
    pub id: String,
    pub dependencies: Vec<String>,
    pub superseded: Vec<String>,
    pub exercises: usize,
}

impl Lesson {
    pub fn new(id: &str, exercises: usize) -> Self {
        Self { id: id.into(), dependencies: vec![], superseded: vec![], exercises }
    }

    pub fn deps(mut self, ids: &[&str]) -> Self {
        self.dependencies = ids.iter().map(|s| (*s).into()).collect();
        self
    }

    pub fn supersedes(mut self, ids: &[&str]) -> Self {
        self.superseded = ids.iter().map(|s| (*s).into()).collect();
        self
    }
}

#[derive(Clone)]
pub struct Course {
    pub id: String,
    pub dependencies: Vec<String>,
    pub superseded: Vec<String>,
    pub lessons: Vec<Lesson>,
}

impl Course {
    pub fn new(id: &str, lessons: Vec<Lesson>) -> Self {
        Self { id: id.into(), dependencies: vec![], superseded: vec![], lessons }
    }

    pub fn deps(mut self, ids: &[&str]) -> Self {
        self.dependencies = ids.iter().map(|s| (*s).into()).collect();
        self
    }

    pub fn supersedes(mut self, ids: &[&str]) -> Self {
        self.superseded = ids.iter().map(|s| (*s).into()).collect();
        self
    }
}

#[derive(Clone)]
pub struct Attempt {
    pub exercise_id: String,
    pub score: u8,
    pub ago_ms: i64,
}

/// Library, blacklist and attempt log of one scripted learner state.
#[derive(Clone)]
pub struct State {
    pub courses: Vec<Course>,
    pub blacklist: Vec<String>,
    pub attempts: Vec<Attempt>,
}

/// The lesson of an exercise id (`0::1::2` -> `0::1`).
pub fn lesson_of(exercise_id: &str) -> &str {
    exercise_id.rsplit_once("::").map_or(exercise_id, |(lesson, _)| lesson)
}

impl State {
    pub fn new(courses: Vec<Course>) -> Self {
        Self { courses, blacklist: vec![], attempts: vec![] }
    }

    pub fn blacklist(mut self, ids: &[&str]) -> Self {
        self.blacklist.extend(ids.iter().map(|s| (*s).to_string()));
        self
    }

    pub fn exercises_in(&self, lesson_id: &str) -> usize {
        self.courses
            .iter()
            .flat_map(|c| &c.lessons)
            .find(|l| l.id == lesson_id)
            .unwrap_or_else(|| panic!("unknown lesson {lesson_id}"))
            .exercises
    }

    pub fn total_exercises(&self) -> usize {
        self.courses.iter().flat_map(|c| &c.lessons).map(|l| l.exercises).sum()
    }

    /// One attempt; the log is kept oldest first.
    pub fn attempt(mut self, exercise_id: &str, score: u8, ago_ms: i64) -> Self {
        self.attempts.push(Attempt { exercise_id: exercise_id.into(), score, ago_ms });
        self.attempts.sort_by_key(|a| std::cmp::Reverse(a.ago_ms));
        self
    }

    /// Rounds `(score, ago_ms)` over the first `count` exercises of the lesson.
    pub fn attempt_first(mut self, lesson_id: &str, count: usize, rounds: &[(u8, i64)]) -> Self {
        for (score, ago_ms) in rounds {
            for i in 0..count {
                self = self.attempt(&format!("{lesson_id}::{i}"), *score, *ago_ms);
            }
        }
        self
    }

    /// Rounds `(score, ago_ms)` over every exercise of the lesson.
    pub fn attempt_lesson(self, lesson_id: &str, rounds: &[(u8, i64)]) -> Self {
        let count = self.exercises_in(lesson_id);
        self.attempt_first(lesson_id, count, rounds)
    }

    /// Checks the parity constraints of the fixtures (`engine-ts-testing.md` §4).
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.total_exercises() <= MAX_EXERCISES,
            "library exceeds {MAX_EXERCISES} exercises"
        );
        let mut per_exercise = std::collections::BTreeMap::<&str, usize>::new();
        for a in &self.attempts {
            ensure!(a.ago_ms >= 0 && a.ago_ms % 1000 == 0, "bad agoMs {}", a.ago_ms);
            ensure!((1..=5).contains(&a.score), "bad score {}", a.score);
            let lesson = lesson_of(&a.exercise_id);
            let index: usize = a.exercise_id.rsplit("::").next().unwrap().parse()?;
            ensure!(index < self.exercises_in(lesson), "unknown exercise {}", a.exercise_id);
            *per_exercise.entry(&a.exercise_id).or_default() += 1;
        }
        for (id, n) in per_exercise {
            ensure!(n <= 2, "more than 2 attempts on {id}");
        }
        Ok(())
    }

    pub fn library_json(&self) -> Value {
        let ids = |v: &[String]| -> Value { json!(v) };
        let courses: Vec<Value> = self
            .courses
            .iter()
            .map(|c| {
                let lessons: Vec<Value> = c
                    .lessons
                    .iter()
                    .map(|l| {
                        let mut m = Map::new();
                        m.insert("id".into(), json!(l.id));
                        m.insert("exercises".into(), json!(l.exercises));
                        if !l.dependencies.is_empty() {
                            m.insert("dependencies".into(), ids(&l.dependencies));
                        }
                        if !l.superseded.is_empty() {
                            m.insert("superseded".into(), ids(&l.superseded));
                        }
                        Value::Object(m)
                    })
                    .collect();
                let mut m = Map::new();
                m.insert("id".into(), json!(c.id));
                m.insert("lessons".into(), Value::Array(lessons));
                if !c.dependencies.is_empty() {
                    m.insert("dependencies".into(), ids(&c.dependencies));
                }
                if !c.superseded.is_empty() {
                    m.insert("superseded".into(), ids(&c.superseded));
                }
                Value::Object(m)
            })
            .collect();
        json!({ "courses": courses })
    }

    pub fn attempts_json(&self) -> Value {
        Value::Array(
            self.attempts
                .iter()
                .map(|a| json!({"exerciseId": a.exercise_id, "score": a.score, "agoMs": a.ago_ms}))
                .collect(),
        )
    }

    fn test_courses(&self) -> Vec<TestCourse> {
        let test_id = |s: &str| TestId::from(&Ustr::from(s));
        let test_ids = |v: &[String]| v.iter().map(|s| test_id(s)).collect::<Vec<_>>();
        self.courses
            .iter()
            .map(|c| TestCourse {
                id: test_id(&c.id),
                dependencies: test_ids(&c.dependencies),
                encompassed: vec![],
                superseded: test_ids(&c.superseded),
                metadata: Default::default(),
                lessons: c
                    .lessons
                    .iter()
                    .map(|l| TestLesson {
                        id: test_id(&l.id),
                        dependencies: test_ids(&l.dependencies),
                        encompassed: vec![],
                        superseded: test_ids(&l.superseded),
                        metadata: Default::default(),
                        num_exercises: l.exercises,
                    })
                    .collect(),
            })
            .collect()
    }
}

fn mastery(score: u8) -> MasteryScore {
    match score {
        1 => MasteryScore::One,
        2 => MasteryScore::Two,
        3 => MasteryScore::Three,
        4 => MasteryScore::Four,
        5 => MasteryScore::Five,
        _ => unreachable!("validated"),
    }
}

/// A private copy of the library on disk with the learner state applied.
struct Worker {
    root: PathBuf,
    options: SchedulerOptions,
}

static WORKER_COUNTER: AtomicUsize = AtomicUsize::new(0);

impl Worker {
    fn new(state: &State, options: &SchedulerOptions) -> Result<Self> {
        let root = std::env::temp_dir().join(format!(
            "scheduler-golden-{}-{}",
            std::process::id(),
            WORKER_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root)?;
        let worker = Self { root, options: options.clone() };

        let builders = state
            .test_courses()
            .iter()
            .map(TestCourse::course_builder)
            .collect::<Result<Vec<_>>>()?;
        let preferences = UserPreferences {
            scheduler: Some(SchedulerPreferences { batch_size: Some(options.batch_size) }),
            ..Default::default()
        };
        let mut trane = init_simulation(&worker.root, &builders, Some(&preferences))?;
        for unit in &state.blacklist {
            trane.add_to_blacklist(Ustr::from(unit))?;
        }
        let now_s = NOW_MS / 1000;
        for a in &state.attempts {
            let timestamp = now_s - a.ago_ms / 1000;
            trane.override_current_timestamp(Some(timestamp));
            trane.score_exercise(Ustr::from(&a.exercise_id), mastery(a.score), timestamp)?;
        }
        Ok(worker)
    }

    /// One batch on a freshly opened Trane; returns the exercise ids in batch order.
    fn batch(&self) -> Result<Vec<String>> {
        let mut trane = Trane::new_local(&self.root, &self.root)?;
        trane.set_scheduler_options(self.options.clone());
        trane.override_current_timestamp(Some(NOW_MS / 1000));
        let batch = trane.get_exercise_batch(None)?;
        Ok(batch.iter().map(|m| m.id.to_string()).collect())
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Draws `count` independent batches over up to `threads` private copies of the library.
pub fn run_batches(
    state: &State,
    options: &SchedulerOptions,
    count: usize,
    threads: usize,
) -> Result<Vec<Vec<String>>> {
    state.validate()?;
    let threads = threads.clamp(1, count.max(1));
    let results = thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let share = count / threads + usize::from(t < count % threads);
                scope.spawn(move || -> Result<Vec<Vec<String>>> {
                    let worker = Worker::new(state, options)?;
                    (0..share).map(|_| worker.batch()).collect()
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or_else(|_| bail!("worker panicked")))
            .collect::<Result<Vec<_>>>()
    })?;
    Ok(results.into_iter().flatten().collect())
}

/// Scheduler options of a scripted state: defaults with the given overrides.
pub fn options(batch_size: usize, max_lessons_in_progress: Option<usize>) -> SchedulerOptions {
    let mut options = SchedulerOptions { batch_size, ..Default::default() };
    if let Some(max) = max_lessons_in_progress {
        options.max_lessons_in_progress = max;
    }
    options
}

/// Small deterministic PRNG (splitmix64) for building states; never used for batches.
pub struct Rng(pub u64);

impl Rng {
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }

    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.below(hi - lo + 1)
    }
}

// ---------------------------------------------------------------------------------------------
// Output.

pub const TRANE_VERSION: &str = "v0.34.1";
pub const TRANE_COMMIT: &str = "6f5f84a";

pub fn trane_json() -> Value {
    json!({"version": TRANE_VERSION, "commit": TRANE_COMMIT})
}

/// Writes pretty JSON with LF endings and a trailing newline.
pub fn write_json(path: &Path, value: &Value) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(value)? + "\n";
    fs::File::create(path)?.write_all(text.as_bytes())?;
    Ok(())
}

fn command_output(program: &str, args: &[&str]) -> Result<String> {
    let out =
        Command::new(program).args(args).output().with_context(|| format!("run {program}"))?;
    ensure!(out.status.success(), "{program} failed");
    Ok(String::from_utf8(out.stdout)?)
}

fn sha256_of(path: &Path) -> Result<String> {
    let path = path.to_str().unwrap();
    let text = command_output("shasum", &["-a", "256", path])
        .or_else(|_| command_output("sha256sum", &[path]))?;
    Ok(text.split_whitespace().next().unwrap_or_default().to_string())
}

/// Records the fixture (`bin`, `seed`, case count, sha256, ...) in `MANIFEST.json` next to it.
/// Entries of the other generator are preserved.
pub fn update_manifest(fixture: &Path, entry: Value) -> Result<()> {
    let manifest_path = fixture.with_file_name("MANIFEST.json");
    let mut manifest: Value = match fs::read_to_string(&manifest_path) {
        Ok(text) => serde_json::from_str(&text)?,
        Err(_) => json!({}),
    };
    let rustc = command_output("rustc", &["--version"])?;
    manifest["trane"] = trane_json();
    manifest["toolchain"] = json!({"rustc": rustc.trim().split_whitespace().nth(1).unwrap_or("")});
    manifest["generator"] = json!(
        "golden-rs (cargo run --release --offline --bin <name>); the states are deterministic, \
         the batches are NOT: Trane's RNG is thread-local (rand::rng()), so a rerun changes the \
         counts and the sha256; the fixtures are regenerated only deliberately"
    );
    let mut entry = entry;
    entry["sha256"] = json!(sha256_of(fixture)?);
    let name = fixture.file_name().and_then(|n| n.to_str()).unwrap().to_string();
    manifest["fixtures"][name] = entry;
    write_json(&manifest_path, &manifest)
}

/// Output path: first CLI argument or the default next to the TS scheduler tests.
pub fn output_path(default_name: &str) -> PathBuf {
    std::env::args()
        .nth(1)
        .map_or_else(|| Path::new("../../scheduler/golden").join(default_name), PathBuf::from)
}
