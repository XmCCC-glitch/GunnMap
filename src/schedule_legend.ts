import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { xml } from './map_highlighter.js';
import { ROOT } from './project.js';

interface LegendItem {
  period: number;
  label: string;
  floor: number;
  color: string;
}

export async function addScheduleLegend(image: Buffer, selected: readonly LegendItem[]): Promise<Buffer> {
  if (!selected.length) return image;
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error('Map dimensions are missing');

  const padding = 24;
  const rowHeight = 34;
  const legendWidth = 420;
  const legendHeight = 90 + rowHeight * selected.length;
  const left = Math.max(padding, Math.min(420, width - legendWidth - padding));
  const top = height - legendHeight - padding;
  const replacements: Record<string, string> = { HEIGHT: String(legendHeight) };

  for (let index = 0; index < 7; index += 1) {
    const item = selected[index];
    const row = index + 1;
    replacements[`ROW_${row}_DISPLAY`] = item ? 'inline' : 'none';
    replacements[`ROW_${row}_COLOR`] = item ? xml(item.color) : '#000000';
    replacements[`ROW_${row}_LABEL`] = item
      ? xml(`Period ${item.period} · ${item.label}${item.floor === 2 ? ' (2F)' : ''}`)
      : '';
  }

  const asset = await readFile(resolve(ROOT, 'src/map/schedule-legend.svg'), 'utf8');
  const legend = asset.replace(/__([A-Z0-9_]+)__/g, (_, name: string) => {
    if (!Object.hasOwn(replacements, name)) throw new Error(`Unknown schedule legend placeholder: ${name}`);
    return replacements[name];
  });
  return sharp(image)
    .composite([{ input: Buffer.from(legend), left, top }])
    .removeAlpha()
    .png()
    .toBuffer();
}
