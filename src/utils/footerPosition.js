export const FOOTER_POSITION_ITEMS = [
  ['group', 'Get in touch'],
  ['address', 'Morada / Maps'],
  ['email', 'Email'],
  ['whatsapp', 'WhatsApp'],
  ['contact', 'Contact us'],
  ['join', 'Join us'],
  ['instagram', 'Instagram'],
]

export function footerOffset(value) {
  const number = Number.parseFloat(value)
  return `${Number.isFinite(number) ? Math.max(-2000, Math.min(2000, number)) : 0}px`
}

export function footerPositionStyle(position, device) {
  const variables = {}
  for (const screen of ['mobile', 'tablet', 'desktop']) {
    for (const axis of ['x', 'y']) {
      variables[`--footer-${axis}-${screen}`] = footerOffset(position?.[screen]?.[axis])
    }
  }
  if (device) {
    variables.left = footerOffset(position?.[device]?.x)
    variables.top = footerOffset(position?.[device]?.y)
  }
  return variables
}
