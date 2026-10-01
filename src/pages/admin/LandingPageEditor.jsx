import { useEffect, useRef, useState } from 'react'
import { LandingContentProvider, useLandingContent } from '../../content/LandingContentContext'
import EditorTopbar from '../../components/editor/EditorTopbar'
import EditorSidebar from '../../components/editor/EditorSidebar'
import EditorCanvas from '../../components/editor/EditorCanvas'
import PropertiesPanel from '../../components/editor/PropertiesPanel'

function EditorWorkspace({ sidebarsHidden, setSidebarsHidden }) {
  const { selection } = useLandingContent()
  const previousSelection = useRef(selection)

  useEffect(() => {
    const selectionChanged = previousSelection.current !== selection
    previousSelection.current = selection

    if (selectionChanged && selection && sidebarsHidden) setSidebarsHidden(false)
  }, [selection, sidebarsHidden, setSidebarsHidden])

  return (
    <div className="flex-1 flex overflow-hidden">
      {!sidebarsHidden && <EditorSidebar />}
      <EditorCanvas />
      {!sidebarsHidden && <PropertiesPanel />}
    </div>
  )
}

function LandingPageEditor() {
  const [sidebarsHidden, setSidebarsHidden] = useState(false)

  return (
    <LandingContentProvider mode="edit">
      <div className="h-screen w-full flex flex-col bg-black text-white overflow-hidden">
        <EditorTopbar
          sidebarsHidden={sidebarsHidden}
          onToggleSidebars={() => setSidebarsHidden((hidden) => !hidden)}
        />
        <EditorWorkspace sidebarsHidden={sidebarsHidden} setSidebarsHidden={setSidebarsHidden} />
      </div>
    </LandingContentProvider>
  )
}

export default LandingPageEditor
