# Dolphy

**English** · [Русский](README.ru.md)

**Learn in the right order. Remember for good. Keep everything on your computer.**

Dolphy is a desktop app for learning skills that build on each other: SQL, Git, HTTP, JavaScript, or anything you can break into lessons. It does three things flashcards alone can't:

- **Plans your day.** Every morning it picks what to review and which new lesson to start, and it only opens a lesson once the lessons it depends on are mastered.
- **Checks real answers.** Write a SQL query and the app runs it and tells you if it's right. No grading yourself, no fooling yourself.
- **Stays yours.** No account, no server, no telemetry. Courses are plain Markdown files; your progress lives in a single SQLite file on your disk.

[Download](#download) · [Try it from source](#try-it-from-source) · [What's inside](#whats-inside) · [Built on Trane](#built-on-trane)

## Why Dolphy

Most study tools treat knowledge as a pile of cards. But skills aren't a pile. You can't write a window function before you understand `GROUP BY`, and you can't rebase a branch before you understand commits. So you either follow a fixed syllabus and forget the early lessons, or you shuffle a deck and hit material you aren't ready for.

Dolphy models a course as a **graph of lessons with prerequisites** and schedules it with **FSRS**, the modern spaced-repetition algorithm. You always see what is ready to learn, what is due to review, and what is still locked, and the plan makes sure old topics don't fade while you push forward.

## What's inside

|                              |                                                                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Daily plan**               | A short list for today: reviews that are due plus new material, mixed across your courses so similar topics don't pile up. Tune how much is new, how many lessons run in parallel and how strongly you want to remember things.   |
| **Knowledge graph**          | See every lesson as a node: locked, ready, in progress, mastered. Know exactly what unlocks what and why you're stuck.                                                                                                            |
| **Placement test**           | A short adaptive quiz finds what you already know and marks it done, so a course starts where you are, not at page one.                                                                                                           |
| **Runner-checked exercises** | SQL answers are executed in an isolated worker against a practice database and compared with the expected result. Your rating comes from the outcome, not from your mood. Other exercises use classic flip-and-rate self-grading. |
| **Reinforce the basics**     | Keep failing an exercise and the plan pulls in exercises from its prerequisites instead of letting you grind at a wall.                                                                                                           |
| **Several courses at once**  | Switch focus between courses. Each keeps its own progress, and switching never loses anything.                                                                                                                                    |
| **Local-first**              | Progress is an append-only journal in SQLite. It survives a killed process, never leaves the device, and is designed to merge cleanly between devices without a server.                                                           |
| **Yours to write**           | A course is a folder of Markdown and small JSON files. Edit it in any editor, keep it in Git, share it as a zip.                                                                                                                  |
| **Comfortable**              | Light and dark themes, interface in English and Russian.                                                                                                                                                                          |

## A day with Dolphy

1. Open the app. The plan for today is already there.
2. Start a session. Answer a question, run a query, rate how it went.
3. The scheduler updates your memory model and decides when you'll see each item again.
4. Finish a lesson's exercises well enough and its dependents unlock on the graph.
5. Come back tomorrow. Forgotten things return as reviews just before you'd forget them.

## If you know Anki

You'll feel at home: spaced repetition on FSRS (the algorithm [Anki](https://apps.ankiweb.net) itself now offers), a daily queue, a rating after each item. Dolphy adds what a flat deck cannot express:

- **Structure.** Lessons depend on each other. New material appears when you're ready, not when it happens to be next in the deck.
- **Verification.** Code exercises are graded by running them.
- **A sense of progress.** A graph and per-course mastery instead of a single counter of cards.

It is not an Anki replacement for vocabulary or trivia. It's aimed at skills with a dependency structure.

## Built on Trane

Dolphy stands on [**Trane**](https://github.com/trane-project/trane), an open-source practice engine written in Rust for mastering complex, hierarchical skills, originally for jazz improvisation and named after John Coltrane. Trane's core idea is the one this project is built around: skills form a graph, practice follows it, new skills unlock as their prerequisites are mastered, and old ones are reinforced along the way.

We started by reading Trane's source and running experiments against it, then **ported its scheduler to TypeScript** and built a product around it.

| From Trane                                                                             | Added in Dolphy                                                                                                               |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Courses as plain-text files: lessons, exercises, dependencies                          | FSRS memory model (via [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)) instead of Trane's own scoring heuristic |
| Depth-first scheduler: lesson gating, mastery windows, relearn pile, shuffling         | Answers verified by runners (SQL today) instead of self-rating only                                                           |
| "Encompassing" links: practising a hard topic also practises the simple ones inside it | Placement test and targeted reinforcement of prerequisites                                                                    |
| Practice history derived from a log of trials                                          | Mergeable multi-device journal, desktop app with Electron and Vue                                                             |

Trane's own documentation lives at [trane-project.github.io](https://trane-project.github.io/). If you want a Rust library or a terminal workflow, go straight to Trane.

Also studied along the way: [FSRS](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler) and Anki for memory scheduling, Math Academy for prerequisite graphs with weighted links, knowledge space theory for placement, and RemNote and Mochi for authoring ergonomics.

## By the numbers

- **5** sample courses in the repository, **34** lessons, **120** exercises, including **72** SQL exercises checked by running queries.
- **2,800+** automated tests, including property tests for journal merging and a test that kills the process mid-write to prove the journal survives.
- The FSRS implementation is cross-checked against the reference `py-fsrs` on **600** learner histories (**18,564** reviews).
- **3** platforms: macOS, Windows, Linux.
- **0** accounts, servers or trackers.

## Download

Installers for macOS (`.dmg`), Windows (`.exe`) and Linux (`.AppImage`) are attached to every [GitHub Release](../../releases). They are unsigned, so your OS will warn you on first launch.

The installer doesn't include courses yet. A course is a folder; drop it into the app's `library` folder (inside its user-data directory) and press **Settings → Library → Reload**. The quickest way to see the app with real content is to run it from source with the sample courses.

## Try it from source

Needs Node ≥ 22.12 and pnpm 9.15.9.

```sh
pnpm install
pnpm dev:seed   # copy the sample courses (SQL, Git, HTTP, JavaScript) into the library
pnpm dev        # start the app
```

## Roadmap

Working today: daily plan, courses screen and course focus, study sessions, knowledge graph, placement test, settings for the scheduler and library, themes, English and Russian interface.

Next: analytics, adding content from inside the app, a command palette, more exercise types (drag and drop, matching), syncing between devices from the UI. The sample courses are written in Russian for now; the interface is fully bilingual.

## Contributing

The rules for code, git workflow and releases are in [`AGENTS.md`](AGENTS.md) (Russian); the layout of the repository, design documents and research notes are in [`docs/repository.md`](docs/repository.md) (Russian). Commands you'll need most: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
