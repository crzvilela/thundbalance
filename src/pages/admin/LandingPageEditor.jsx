import { LandingContentProvider } from '../../content/LandingContentContext'
import EditorTopbar from '../../components/editor/EditorTopbar'
import EditorSidebar from '../../components/editor/EditorSidebar'
import EditorCanvas from '../../components/editor/EditorCanvas'
import PropertiesPanel from '../../components/editor/PropertiesPanel'

function LandingPageEditor() {
  return (
    <LandingContentProvider mode="edit">
      <div className="h-screen w-full flex flex-col bg-black text-white overflow-hidden">
        <EditorTopbar />
        <div className="flex-1 flex overflow-hidden">
          <EditorSidebar />
          <EditorCanvas />
          <PropertiesPanel />
        </div>
      </div>
    </LandingContentProvider>
  )
}

export default LandingPageEditor
