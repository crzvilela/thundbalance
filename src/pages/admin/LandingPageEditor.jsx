import { useState } from 'react'
import { LandingContentProvider } from '../../content/LandingContentContext'
import EditorTopbar from '../../components/editor/EditorTopbar'
import EditorSidebar from '../../components/editor/EditorSidebar'
import EditorCanvas from '../../components/editor/EditorCanvas'
import PropertiesPanel from '../../components/editor/PropertiesPanel'

// Sections menu on the left, the page in the middle, and a floating panel on
// the right that only exists while something is selected (it floats over the
// page so selecting never changes the page's width).
function EditorWorkspace({ sidebarHidden }) {
  return (
    <div className="relative flex flex-1 overflow-hidden">
      {!sidebarHidden && <EditorSidebar />}
      <EditorCanvas />
      <PropertiesPanel />
    </div>
  )
}

function LandingPageEditor() {
  const [sidebarHidden, setSidebarHidden] = useState(false)

  return (
    <LandingContentProvider mode="edit">
      <div className="flex h-screen w-full flex-col overflow-hidden bg-black text-white">
        <EditorTopbar sidebarHidden={sidebarHidden} onToggleSidebar={() => setSidebarHidden((hidden) => !hidden)} />
        <EditorWorkspace sidebarHidden={sidebarHidden} />
      </div>
    </LandingContentProvider>
  )
}

export default LandingPageEditor
