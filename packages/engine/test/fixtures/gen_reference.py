"""Generate 600 random histories + py-fsrs reference values.
Run: /tmp/venvfsrs/bin/python fixtures/gen_reference.py
Times are integer epoch SECONDS (so both sides see identical instants)."""
import json, random, sys, math
from datetime import datetime, timezone, timedelta
import fsrs
from fsrs import Scheduler, Card, Rating

rng = random.Random(20260929)
sch = Scheduler(learning_steps=(), relearning_steps=(), enable_fuzzing=False, maximum_interval=36500)
RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]
WEIGHTS = [15, 5, 70, 10]
BASE = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp())

def dt(s): return datetime.fromtimestamp(s, tz=timezone.utc)

out = []
for h in range(600):
    n = rng.randint(1, 60)
    t = BASE + rng.randint(0, 365 * 86400)  # random time of day too
    times, grades = [], []
    for i in range(n):
        if i > 0:
            if rng.random() < 0.4:
                t += rng.randint(60, 20 * 3600)
            else:
                t += rng.randint(86400, 400 * 86400)
        times.append(t)
        grades.append(rng.choices([1, 2, 3, 4], weights=WEIGHTS)[0])
    q = [rng.uniform(0, 2), rng.uniform(1, 400), rng.uniform(0, 2) if rng.random() < .5 else rng.uniform(1, 400)]
    qs = [times[-1] + int(x * 86400) for x in q]
    card = Card()
    trace = []
    for ti, g in zip(times, grades):
        card, _ = sch.review_card(card, Rating(g), review_datetime=dt(ti))
        trace.append([card.stability, card.difficulty])
    fr = []
    R_floor, R_frac = [], []
    for qt in qs:
        R_floor.append(sch.get_card_retrievability(card, dt(qt)))
        days = (qt - times[-1]) / 86400
        R_frac.append((1 + sch._FACTOR * days / card.stability) ** sch._DECAY)
    out.append(dict(times=times, grades=grades, queries=qs, trace=trace,
                    stability=card.stability, difficulty=card.difficulty,
                    r_floor=R_floor, r_frac=R_frac))
json.dump(dict(pyfsrs_version=__import__("importlib.metadata").metadata.version("fsrs"), items=out),
          open("fixtures/reference.json", "w"))
print("ok", len(out), fsrs.__file__)
