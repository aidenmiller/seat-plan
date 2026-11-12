/**
 * The sample guest file offered on the Guests page and in the import dialog
 * (spec section 6). The spec's ten columns in its order, plus one column the
 * app does not know ("Table wish"), which the import puts into notes. The
 * rows are made up and cover a partner pair, ";"-split groups, accents, a
 * particle name, children and an apostrophe. The same text is checked in
 * at public/samples/guests-sample.csv, with a byte order mark; a test keeps
 * the two the same.
 */
import { SAMPLE_COLUMNS } from './columns'
import { CSV_BOM, csvLines } from './export'

export const SAMPLE_CSV_FILE_NAME = 'guests-sample.csv'
/** Where the app serves the sample file (behind sign-in). */
export const SAMPLE_CSV_URL = `/samples/${SAMPLE_CSV_FILE_NAME}`

const EXTRA_COLUMN = 'Table wish'

const ROWS: readonly (readonly string[])[] = [
  [...SAMPLE_COLUMNS, EXTRA_COLUMN],
  ['Zoë', 'Kowalczyk', 'Łukasz Kowalczyk', 'Kowalczyk', 'Partner 1', 'Noa Family; Noa Cousins', 'yes', 'Fish', 'no', 'Allergic to nuts', 'Near the dance floor'],
  ['Łukasz', 'Kowalczyk', 'Zoë Kowalczyk', 'Kowalczyk', 'Partner 1', 'Noa Family', 'yes', 'Beef', 'no', '', ''],
  ['Mia', 'Kowalczyk', '', 'Kowalczyk', 'Partner 1', 'Noa Family', 'yes', 'Kids meal', 'yes', 'Needs a booster seat', ''],
  ['Daniel', "O'Connor", 'Priya Raman', "O'Connor and Raman", 'Partner 2', 'Aiden HS Friends', 'yes', 'Chicken', 'no', '', 'Away from the speakers'],
  ['Priya', 'Raman', "Daniel O'Connor", "O'Connor and Raman", 'Partner 2', 'Aiden HS Friends; Book Club', 'pending', 'Vegetarian', 'no', '', ''],
  ['José', 'García', '', '', 'Both', 'Work Friends', 'yes', 'Vegetarian', 'no', 'Arrives after the ceremony', ''],
  ['Anna', 'van der Berg', '', '', 'Partner 2', 'Aiden Family', 'no', '', 'no', 'Sends her regrets', ''],
  ['Renée', 'Dubois', '', '', 'Partner 1', 'Noa College', 'pending', '', 'no', '', 'Near Zoë'],
  ['Sam', 'Lee', '', 'Lee', 'Partner 2', 'Aiden Family; Aiden Cousins', 'yes', 'Fish', 'no', '', ''],
  ['Theo', 'Lee', '', 'Lee', 'Partner 2', 'Aiden Family', 'yes', 'Kids meal', 'yes', '', ''],
]

/** The sample as text, CRLF line ends, without a byte order mark. */
export const SAMPLE_CSV_TEXT = csvLines(ROWS)

/** The bytes' text as served: byte order mark first, so Excel reads the accents. */
export const SAMPLE_CSV_FILE = CSV_BOM + SAMPLE_CSV_TEXT
