import { useRef } from "preact/hooks";
import { Palette } from "lucide-preact";
import { cn } from "@/lib/utils";
import { SERVICE_COLORS, isPresetColor, normalizeColor } from "../../shared/service-colors";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const customInputRef = useRef<HTMLInputElement>(null);
  const isCustom = !isPresetColor(value);

  return (
    <div className="space-y-2">
      <div
        className="h-2 w-full rounded-md border"
        style={{ backgroundColor: value }}
        aria-hidden
      />
      <div className="grid grid-cols-8 gap-1.5">
        {SERVICE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={normalizeColor(value) === normalizeColor(c)}
            className={cn(
              "aspect-square w-full rounded-md transition-transform",
              normalizeColor(value) === normalizeColor(c)
                ? "scale-105 ring-2 ring-ring ring-offset-1"
                : "hover:scale-105",
            )}
            style={{ backgroundColor: c }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Choose custom color"
          aria-pressed={isCustom}
          className={cn(
            "relative h-8 w-8 shrink-0 overflow-hidden rounded-md border border-dashed border-muted-foreground/40 transition-transform",
            isCustom && "scale-105 ring-2 ring-ring ring-offset-1",
          )}
          style={isCustom ? { backgroundColor: value } : undefined}
          onClick={() => customInputRef.current?.click()}
        >
          {!isCustom && (
            <span
              className="absolute inset-0"
              style={{
                background:
                  "conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
              }}
            />
          )}
          <Palette className="relative z-10 m-auto h-3.5 w-3.5 text-white drop-shadow" />
        </button>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => customInputRef.current?.click()}
        >
          {isCustom ? "Custom color" : "Choose custom color"}
        </button>
        <input
          ref={customInputRef}
          type="color"
          className="sr-only"
          value={value}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        />
      </div>
    </div>
  );
}
