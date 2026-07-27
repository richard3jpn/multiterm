import { ThemeProvider } from './contexts/theme-context'
import { SettingsProvider } from './contexts/settings-context'
import { Workspace } from './components/Workspace'

function App() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <Workspace />
      </SettingsProvider>
    </ThemeProvider>
  )
}

export default App
