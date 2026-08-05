import { Moon, Sun } from 'lucide-react';
import type { ThemeName } from '../lib/theme';

interface ThemeToggleProps {
  theme: ThemeName;
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const next = theme === 'carbon' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      className="btn btn-ghost btn-icon"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === 'carbon' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </button>
  );
}
