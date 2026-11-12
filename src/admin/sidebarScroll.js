// How far a scrolling menu must move so that one of its items is fully inside it (0 when it already is).
// `box` and `item` are bounding rectangles ({ top, bottom }); `margin` keeps a little air around the item.
export function scrollDelta(box, item, margin = 8) {
  if (item.top < box.top + margin) return item.top - box.top - margin
  if (item.bottom > box.bottom - margin) return item.bottom - box.bottom + margin
  return 0
}
