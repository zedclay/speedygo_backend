/** Authoritative Branch opening-hours timezone (IANA). */
export const OPENING_HOURS_TIMEZONE = 'Africa/Algiers';

/** Maximum intervals allowed on a single ISO weekday. */
export const OPENING_HOURS_MAX_INTERVALS_PER_DAY = 3;

/** Maximum intervals across the whole weekly schedule. */
export const OPENING_HOURS_MAX_TOTAL_INTERVALS = 21;

/** Minutes in a civil day. */
export const MINUTES_PER_DAY = 1440;

/** ISO weekdays Mon=1 .. Sun=7. */
export const ISO_DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 7] as const;

export type IsoDayOfWeek = (typeof ISO_DAYS_OF_WEEK)[number];
