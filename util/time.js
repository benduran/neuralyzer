
/**
 * Given a JS Date object,
 * converts it into a DD/M/YYYY (HH:MM:SS) string,
 * where time component is optional
 * @param {Date} date - JS Date object to convert
 * @param {boolean} [includeTime=true] - If true, includes the time component when string formatting the date
 * @returns {String} Formatted date string
 */
function dateToUTCString(date, includeTime = true) {
  const utc = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
  const day = utc.getDate();
  const month = utc.getMonth() + 1;
  const year = utc.getFullYear();
  const hours = utc.getHours();
  const minutes = utc.getMinutes();
  const seconds = utc.getSeconds();
  let formatted = `${day}/${month}/${year}`;
  if (includeTime) {
    formatted = `${formatted} ${hours < 10 ? '0' : ''}${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  return formatted;
}

exports.dateToUTCString = dateToUTCString;
