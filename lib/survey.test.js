import { describe, it, expect } from 'vitest';
import {
  QUESTION_SET_VERSION,
  SESSION_OPTIONS,
  getQuestionSet,
  isValidDay,
  dayForDate,
  calculateNps,
  mean,
  distribution,
  summariseDay,
  buildFeedbackReport,
} from './survey.js';

describe('getQuestionSet', () => {
  it('gives every day a rating, an NPS and the two open questions', () => {
    for (const day of ['day1', 'day2', 'day3']) {
      const ids = getQuestionSet(day).questions.map((q) => q.id);
      expect(ids).toContain('dayRating');
      expect(ids).toContain('nps');
      expect(ids).toContain('bestThing');
      expect(ids).toContain('improve');
    }
  });

  it('asks the closing questions on day 3 only', () => {
    const day3 = getQuestionSet('day3').questions.map((q) => q.id);
    const day1 = getQuestionSet('day1').questions.map((q) => q.id);
    expect(day3).toContain('confidence');
    expect(day3).toContain('testimonial');
    expect(day1).not.toContain('confidence');
    expect(day1).not.toContain('testimonial');
  });

  it('stamps the version so a report never mixes question sets', () => {
    expect(getQuestionSet('day1').version).toBe(QUESTION_SET_VERSION);
  });

  it('refuses an unknown day rather than serving an empty survey', () => {
    expect(() => getQuestionSet('day4')).toThrow();
  });
});

describe('isValidDay', () => {
  it('accepts the three workshop days only', () => {
    expect(isValidDay('day1')).toBe(true);
    expect(isValidDay('day3')).toBe(true);
    expect(isValidDay('day4')).toBe(false);
    expect(isValidDay('')).toBe(false);
  });
});

describe('dayForDate', () => {
  // August runs 7-9 Aug 2026. The survey opens at the end of each session
  // (2pm ET = 18:00 UTC) and stays open overnight.
  it('maps each workshop date to its day', () => {
    expect(dayForDate(Date.UTC(2026, 7, 7, 19, 0, 0))).toBe('day1');
    expect(dayForDate(Date.UTC(2026, 7, 8, 19, 0, 0))).toBe('day2');
    expect(dayForDate(Date.UTC(2026, 7, 9, 19, 0, 0))).toBe('day3');
  });

  it('keeps day 1 selected late into the evening, in Eastern terms', () => {
    // 11pm ET on day 1 is already the 8th in UTC.
    expect(dayForDate(Date.UTC(2026, 7, 8, 3, 0, 0))).toBe('day1');
  });

  it('returns null outside the workshop so the form asks instead of guessing', () => {
    expect(dayForDate(Date.UTC(2026, 7, 1, 12, 0, 0))).toBeNull();
    expect(dayForDate(Date.UTC(2026, 7, 20, 12, 0, 0))).toBeNull();
  });
});

describe('calculateNps', () => {
  it('is promoters minus detractors as a percentage, not an average', () => {
    // 2 promoters, 1 passive, 1 detractor → 50% - 25% = 25.
    expect(calculateNps([10, 9, 8, 3]).score).toBe(25);
  });

  it('reports the bands it used', () => {
    const b = calculateNps([10, 9, 8, 7, 6, 0]);
    expect(b.promoters).toBe(2);
    expect(b.passives).toBe(2);
    expect(b.detractors).toBe(2);
    expect(b.responses).toBe(6);
  });

  it('goes fully negative when everyone is a detractor', () => {
    expect(calculateNps([0, 3, 6]).score).toBe(-100);
  });

  it('is null with no answers, because 0 is a real NPS', () => {
    expect(calculateNps([]).score).toBeNull();
    expect(calculateNps([null, undefined]).score).toBeNull();
  });

  it('ignores out-of-range junk rather than scoring it', () => {
    expect(calculateNps([10, 11, -2, 'nine']).responses).toBe(1);
  });
});

describe('mean', () => {
  it('averages the answers that exist', () => {
    expect(mean([8, 10, null, 6])).toBe(8);
  });

  it('is null when nothing was answered', () => {
    expect(mean([null, undefined])).toBeNull();
  });
});

describe('distribution', () => {
  it('counts each option and keeps the declared order', () => {
    const d = distribution(['Good', 'Excellent', 'Good'], SESSION_OPTIONS);
    expect(d).toEqual([
      { option: 'Excellent', count: 1 },
      { option: 'Good', count: 2 },
      { option: 'Fair', count: 0 },
      { option: 'Poor', count: 0 },
      { option: 'Missed it', count: 0 },
    ]);
  });
});

describe('summariseDay', () => {
  const responses = [
    { day: 'day1', respondent: 'a', nps: 10, dayRating: 9, answers: { teaching: 'Excellent' } },
    { day: 'day1', respondent: 'b', nps: 6, dayRating: 5, answers: { teaching: 'Fair' } },
  ];

  it('counts responses, averages the rating and scores NPS', () => {
    const s = summariseDay('day1', responses);
    expect(s.responses).toBe(2);
    expect(s.dayRating).toBe(7);
    expect(s.nps.score).toBe(0); // 50% promoters - 50% detractors
  });

  it('counts a person once even if they submitted twice', () => {
    const dupes = [...responses, { day: 'day1', respondent: 'a', nps: 9, dayRating: 9, answers: {} }];
    expect(summariseDay('day1', dupes).respondents).toBe(2);
  });
});

describe('buildFeedbackReport', () => {
  const responses = [
    { day: 'day1', respondent: 'a', nps: 8, dayRating: 8, answers: {} },
    { day: 'day1', respondent: 'b', nps: 10, dayRating: 9, answers: {} },
    { day: 'day2', respondent: 'a', nps: 9, dayRating: 9, answers: {} },
    { day: 'day3', respondent: 'a', nps: 10, dayRating: 10, answers: {} },
    { day: 'day3', respondent: 'b', nps: 9, dayRating: 9, answers: {} },
  ];

  it('reports all three days in order, including days nobody answered', () => {
    const r = buildFeedbackReport(responses.filter((x) => x.day !== 'day2'));
    expect(r.days.map((d) => d.day)).toEqual(['day1', 'day2', 'day3']);
    expect(r.days[1].responses).toBe(0);
    expect(r.days[1].nps.score).toBeNull();
  });

  it('headlines the day 3 NPS, not a pooled average', () => {
    const r = buildFeedbackReport(responses);
    // Day 3 is 2 promoters of 2 → 100. A pooled score would be lower.
    expect(r.headlineNps.score).toBe(100);
    expect(r.headlineNps.basis).toBe('day3');
  });

  it('falls back to the latest day that has answers', () => {
    const r = buildFeedbackReport(responses.filter((x) => x.day === 'day1'));
    expect(r.headlineNps.basis).toBe('day1');
  });

  it('counts each attendee once across the whole workshop', () => {
    expect(buildFeedbackReport(responses).respondents).toBe(2);
  });

  it('survives an empty workshop without inventing numbers', () => {
    const r = buildFeedbackReport([]);
    expect(r.respondents).toBe(0);
    expect(r.headlineNps.score).toBeNull();
    expect(r.days).toHaveLength(3);
  });
});
