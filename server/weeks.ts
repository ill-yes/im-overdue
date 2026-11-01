import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { readState } from './db.js';
import { bad, body, HttpError, route } from './http.js';
import { bool, monday } from './validation.js';
import { mutate } from './state-changes.js';
import { weekReview, weekReviewKey } from '../shared/week-review.js';
import { weekStartFor } from '../shared/time.js';

/** Week review and closing. */
export function registerWeekRoutes(app: Express, db: DatabaseSync): void {
  app.get('/api/weeks/:weekStart/review', route((req, res) => {
    res.json(weekReview(readState(db), monday(req.params.weekStart)));
  }));
  app.post('/api/weeks/:weekStart', route((req, res) => {
    const b = body(req);
    const week = monday(req.params.weekStart);
    if (!['open', 'closed'].includes(String(b.status))) throw bad('error.week.status');
    const confirmWarnings = bool(b.confirmWarnings, 'confirmWarnings');
    if (b.reviewKey !== undefined && (typeof b.reviewKey !== 'string' || !b.reviewKey.length || b.reviewKey.length > 20_000))
      throw bad('error.week.reviewKey');
    const state = mutate(db, b, old => {
      if (b.status === 'closed') {
        const review = weekReview(old, week);
        if (b.reviewKey !== undefined && b.reviewKey !== weekReviewKey(review))
          throw new HttpError(409, 'error.week.reviewChanged', 'WEEK_REVIEW_REQUIRED', undefined, review);
        const current = weekStartFor(review.today);
        if (week > current) throw bad('error.week.future');
        if (week === current && !bool(b.confirmCurrent, 'confirmCurrent'))
          throw new HttpError(409, 'error.week.current', 'CURRENT_WEEK_CONFIRM_REQUIRED');
        if (review.warnings.length && !confirmWarnings)
          throw new HttpError(409, 'error.week.warnings', 'WEEK_REVIEW_REQUIRED', undefined, review);
      }
      db.prepare('INSERT INTO weeks(week_start,status) VALUES (?,?) ON CONFLICT(week_start) DO UPDATE SET status=excluded.status').run(week, b.status as string);
    });
    res.json(state);
  }));
}
