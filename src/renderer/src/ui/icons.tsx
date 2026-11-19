// Icon helpers: weather conditions and the small glyph that tells item kinds apart.

import {
  Circle,
  CircleCheck,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  GraduationCap,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import type { PlannerItem } from '../../../shared/items';
import { conditionFor, type Condition } from '../../../shared/weather';

const WEATHER: Record<Condition, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

export function WeatherIcon({ code, size = 14, className }: { code: number; size?: number; className?: string }) {
  const { kind, label } = conditionFor(code);
  const Icon = WEATHER[kind];
  return <Icon size={size} strokeWidth={1.75} className={className} aria-label={label} role="img" />;
}

/** Graduation cap for assignments, a ring (checked when done) for tasks, nothing for events. */
export function KindGlyph({ item, size = 11 }: { item: Pick<PlannerItem, 'kind' | 'done'>; size?: number }) {
  if (item.kind === 'assignment') return <GraduationCap className="glyph" size={size} strokeWidth={2} aria-hidden />;
  if (item.kind === 'task') {
    const Icon = item.done ? CircleCheck : Circle;
    return <Icon className="glyph" size={size} strokeWidth={2} aria-hidden />;
  }
  return null;
}
