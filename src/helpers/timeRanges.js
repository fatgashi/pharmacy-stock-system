/**
 * Global helpers for time range operations
 * Why: keep overlap logic consistent and correct on the boundaries; validate enums; avoid DATE(...) on indexed columns.
 */

/**
 * Generate SQL fragment and params for date range overlap detection
 * @param {string} from - Start date (YYYY-MM-DD)
 * @param {string} to - End date (YYYY-MM-DD)
 * @returns {Array} [sqlFragment, params]
 */
exports.overlapsDate = (from, to) => [
  // SQL fragment and params for date ranges
  `NOT (end_date < ? OR start_date > ?)`,
  [from, to],
];

/**
 * Generate SQL fragment and params for datetime range overlap detection
 * @param {string} start - Start datetime (YYYY-MM-DD HH:MM:SS)
 * @param {string} end - End datetime (YYYY-MM-DD HH:MM:SS)
 * @returns {Array} [sqlFragment, params]
 */
exports.overlapsDateTime = (start, end) => [
  // SQL fragment and params for datetime ranges
  `NOT (end_datetime <= ? OR start_datetime >= ?)`,
  [start, end],
];

/**
 * Validate half-day enum values
 * @param {string} x - Value to validate
 * @returns {boolean} True if valid
 */
exports.validHalf = (x) => ['AM', 'PM', 'FULL'].includes(x);

/**
 * Validate day of week (0-6, where 0=Sunday)
 * @param {number} dow - Day of week
 * @returns {boolean} True if valid
 */
exports.validDayOfWeek = (dow) => Number.isInteger(dow) && dow >= 0 && dow <= 6;

/**
 * Validate time format (HH:MM:SS)
 * @param {string} time - Time string
 * @returns {boolean} True if valid
 */
exports.validTime = (time) => {
  if (!time || typeof time !== 'string') return false;
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
  return timeRegex.test(time);
};

/**
 * Check if start time is before end time
 * @param {string} startTime - Start time (HH:MM:SS)
 * @param {string} endTime - End time (HH:MM:SS)
 * @returns {boolean} True if start is before end
 */
exports.isTimeOrderValid = (startTime, endTime) => {
  if (!this.validTime(startTime) || !this.validTime(endTime)) return false;
  return startTime < endTime;
};

/**
 * Check if start datetime is before end datetime
 * @param {string} startDateTime - Start datetime
 * @param {string} endDateTime - End datetime
 * @returns {boolean} True if start is before end
 */
exports.isDateTimeOrderValid = (startDateTime, endDateTime) => {
  if (!startDateTime || !endDateTime) return false;
  return new Date(startDateTime) < new Date(endDateTime);
};
