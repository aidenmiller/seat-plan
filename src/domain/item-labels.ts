/**
 * The short name of a seated item, stored in layout_seats.item_label so delete
 * summaries and guest removal can name a table or row without opening canvases.
 *
 *  - a table still called "Table N" (N its number) gives "Table N";
 *  - a renamed table gives "<name> (table N)"; a blank name counts as unrenamed;
 *  - a chair row gives its row label, or "Row N", after "<block label>, " when
 *    it belongs to a labelled block.
 */
import type { ChairRow, Table } from './canvas-schema'

export function itemLabel(item: Table | ChairRow): string {
  if (item.kind === 'table') {
    const plain = `Table ${item.number}`
    const name = item.name.trim()
    if (name === '' || name === plain) return plain
    return `${name} (table ${item.number})`
  }
  const row = item.rowLabel.trim() || `Row ${item.rowNumber}`
  const block = item.blockLabel?.trim() ?? ''
  return block ? `${block}, ${row}` : row
}
