import Editable from './Editable'
import { useAdminText } from './useAdminText'
import { editableText } from './uiRegistry'

// One of the texts of the panel that the studio can rename (the closed list in uiTexts.js, by `id` = "<page>.<element>"). Outside edit mode it is
// exactly the text it replaces: no element, no extra markup, the custom text if there is one and the original (ES / EN) otherwise. In edit mode
// (only for the main admin) it is the <Editable> field. An id that is not in the list draws nothing: a test checks every id used in the code.
export default function Txt({ id, as = 'text', className }) {
  const { t } = useAdminText()
  const entry = editableText(`text:${id}`)
  if (!entry) return null
  return <Editable as={as} keyPath={entry.path} defaultText={t(entry.defaultKey)} className={className} />
}
