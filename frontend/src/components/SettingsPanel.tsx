import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSettings } from '../contexts/settings-context';
import { FONT_PRESETS, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../features/settings/settings';

/** フォント設定（RDD 9.1章）UI。シェル選択は新規ターミナルボタンの▼へ移設（RDD 9.5章） */
export function SettingsPanel() {
  const { settings, setFontFamilyId, setFontSize } = useSettings();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="icon"
        title="設定"
        aria-label="設定"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-label="ターミナル設定"
            className="absolute right-0 z-50 mt-2 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md"
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="font-family" className="text-xs font-medium">
                  フォント
                </label>
                <select
                  id="font-family"
                  value={settings.fontFamilyId}
                  onChange={(e) => setFontFamilyId(e.target.value)}
                  className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                >
                  {FONT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="font-size" className="text-xs font-medium">
                  フォントサイズ: {settings.fontSize}px
                </label>
                <input
                  id="font-size"
                  type="range"
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={1}
                  value={settings.fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
