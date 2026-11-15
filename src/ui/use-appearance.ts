import { useEffect } from 'react';
import type { DeviceAppearance } from '../core/device-appearance';

export function useAppearance(value: DeviceAppearance) {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)'), root = document.documentElement;
    const apply = () => {
      root.dataset.theme = value.theme === 'system' ? (media.matches ? 'dark' : 'light') : value.theme;
      root.dataset.density = value.density;
      root.style.setProperty('--font-scale', String(value.font_scale));
    };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [value]);
}
