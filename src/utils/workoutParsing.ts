import { getAPIKeyCached, getAPIKey, type ImageAttachment } from '../hooks/useAI';

export interface ParsedWorkoutPlan {
  name: string;
  description: string;
  daysPerWeek: number;
  days: {
    name: string;
    notes: string;
    exercises: {
      name: string;
      targetSets: number;
      targetReps: string;
      restSeconds: number;
    }[];
  }[];
}

export function emptyParsedWorkoutPlan(): ParsedWorkoutPlan {
  return {
    name: '',
    description: '',
    daysPerWeek: 3,
    days: [],
  };
}

function normalizeWorkoutName(raw: string) {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function parseRestSeconds(text: string): number {
  const minuteRange = text.match(/(\d+)\s*[–-]\s*(\d+)\s*min/i);
  if (minuteRange) return Math.round(((Number(minuteRange[1]) + Number(minuteRange[2])) / 2) * 60);

  const minuteSingle = text.match(/(\d+)\s*min/i);
  if (minuteSingle) return Number(minuteSingle[1]) * 60;

  const secondRange = text.match(/(\d+)\s*[–-]\s*(\d+)\s*sec/i);
  if (secondRange) return Math.round((Number(secondRange[1]) + Number(secondRange[2])) / 2);

  const secondSingle = text.match(/(\d+)\s*sec/i);
  if (secondSingle) return Number(secondSingle[1]);

  return 90;
}

export function parseExerciseLine(line: string) {
  const trimmed = line.replace(/^[•\-*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
  if (!trimmed) return null;

  let name = '';
  let prescription = '';

  const dashMatch = trimmed.match(/^(.*?)\s+[—-]\s+(.+)$/);
  const colonMatch = trimmed.match(/^(.*?):\s*(.+)$/);
  const inlineSetRepMatch = trimmed.match(/^(.*?)(\d+\s*x\s*[\d,\s–-]+(?:AMRAP)?|AMRAP.*)$/i);

  if (dashMatch) {
    name = normalizeWorkoutName(dashMatch[1]);
    prescription = dashMatch[2].trim();
  } else if (colonMatch) {
    name = normalizeWorkoutName(colonMatch[1]);
    prescription = colonMatch[2].trim();
  } else if (inlineSetRepMatch) {
    name = normalizeWorkoutName(inlineSetRepMatch[1]);
    prescription = inlineSetRepMatch[2].trim();
  } else {
    return null;
  }

  if (!name || !prescription) return null;

  const setRepMatch = prescription.match(/(\d+)\s*x\s*([\d,\s–-]+(?:AMRAP)?|AMRAP)/i);
  if (setRepMatch) {
    return {
      name,
      targetSets: Number(setRepMatch[1]),
      targetReps: setRepMatch[2].replace(/\s+/g, ' ').trim(),
      restSeconds: 90,
    };
  }

  const setsOnly = prescription.match(/(\d+)(?:\s*[–-]\s*(\d+))?\s+sets?/i);
  if (setsOnly) {
    const lower = Number(setsOnly[1]);
    const upper = setsOnly[2] ? Number(setsOnly[2]) : lower;
    return {
      name,
      targetSets: upper,
      targetReps: 'AMRAP',
      restSeconds: 90,
    };
  }

  return {
    name,
    targetSets: 3,
    targetReps: prescription,
    restSeconds: 90,
  };
}

export async function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });

  const [header, base64] = dataUrl.split(',');
  const mimeType = header.match(/data:(.*?);/)?.[1] ?? file.type ?? 'image/png';
  return { base64, mimeType, preview: dataUrl };
}

export async function extractWorkoutPlanFromImage(userId: string, image: ImageAttachment): Promise<string> {
  const key = getAPIKeyCached(userId) ?? await getAPIKey(userId);
  if (!key) {
    throw new Error('Add your AI key first in Profile → Data before importing workout images.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const prompt = [
    'You are extracting a workout plan from an image.',
    'Read the routine and convert it into a clean plain-text format for app import.',
    'Output only structured plain text in this shape:',
    'Plan Title',
    'WEEKLY SPLIT',
    'Day 1 - Name',
    '- Exercise - 4x8-10',
    '- Exercise - 3x12',
    '',
    'Rules:',
    '- Keep only the workout plan content.',
    '- Use one DAY section per workout day you can identify.',
    '- Normalize exercise lines to "- Name - sets x reps" when possible.',
    '- If reps are unclear, keep the visible prescription text after the second dash.',
    '- Do not output markdown fences or commentary.',
  ].join('\n');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: image.mimeType, data: image.base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Could not extract workout text from image (${response.status}). ${body.slice(0, 180)}`.trim());
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part?.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('The image was read, but no workout text could be extracted.');
  }

  return text;
}

function isDayHeader(line: string) {
  return /^DAY\s+\d+/i.test(line);
}

function extractDayName(header: string) {
  const normalized = header.trim();
  const explicitMatch = normalized.match(/^DAY\s+\d+\s*[—:-]\s*(.+)$/i);
  if (explicitMatch) return explicitMatch[1].trim();

  const implicitMatch = normalized.match(/^DAY\s+\d+\s+(.+)$/i);
  if (implicitMatch) return implicitMatch[1].trim();

  return normalized;
}

export function parseWorkoutPlanText(raw: string): ParsedWorkoutPlan {
  const normalized = raw.replace(/\r/g, '').trim();
  if (!normalized) {
    throw new Error('Paste a workout plan first.');
  }

  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const name = lines[0];
  const splitIndex = lines.findIndex(line => line.toUpperCase().startsWith('WEEKLY SPLIT'));

  const dayHeaderIndexes = lines
    .map((line, index) => (isDayHeader(line) ? index : -1))
    .filter(index => index >= 0);

  if (dayHeaderIndexes.length === 0) {
    throw new Error('Could not find any day sections.');
  }

  const descriptionEnd = splitIndex === -1 ? dayHeaderIndexes[0] : splitIndex;
  const descriptionParts = lines.slice(1, descriptionEnd).filter(line => !/^GOAL:?$/i.test(line) && !/^[-–—]+$/.test(line));
  const weeklySplitStart = splitIndex === -1 ? dayHeaderIndexes[0] : splitIndex + 1;
  const weeklySplitEnd = dayHeaderIndexes[0];
  const weeklySplitLines = lines.slice(weeklySplitStart, weeklySplitEnd).filter(line => /^Day\s+\d+/i.test(line));

  const parsedDays = dayHeaderIndexes.map((startIndex, idx) => {
    const endIndex = dayHeaderIndexes[idx + 1] ?? lines.length;
    const header = lines[startIndex];
    const dayName = extractDayName(header);
    const sectionLines = lines.slice(startIndex + 1, endIndex).filter(line => !/^[-–—]+$/.test(line));

    let defaultRest = 90;
    let inRestBlock = false;
    const notes: string[] = [];
    const exercises: ParsedWorkoutPlan['days'][number]['exercises'] = [];

    for (const line of sectionLines) {
      if (/^REST:?$/i.test(line)) {
        inRestBlock = true;
        continue;
      }

      if (/^(NOTE|CARDIO|KEY RULES?|PROGRESSION RULE|RESULT TIMELINE|FINAL GOAL):?/i.test(line)) {
        inRestBlock = false;
        notes.push(line.replace(/:$/, ''));
        continue;
      }

      if (/^[•-]\s*/.test(line)) {
        if (inRestBlock) {
          defaultRest = parseRestSeconds(line);
          notes.push(`Rest guidance: ${line.replace(/^[•-]\s*/, '')}`);
          continue;
        }

        const parsedExercise = parseExerciseLine(line);
        if (parsedExercise) {
          exercises.push({ ...parsedExercise, restSeconds: defaultRest });
        } else {
          notes.push(line.replace(/^[•-]\s*/, ''));
        }
        continue;
      }

      if (/^OR$/i.test(line)) {
        notes.push('OR');
        continue;
      }

      notes.push(line);
    }

    return {
      name: dayName,
      notes: notes.join('\n').trim(),
      exercises,
    };
  });

  return {
    name,
    description: [descriptionParts.join('\n'), weeklySplitLines.length > 0 ? `Weekly split:\n${weeklySplitLines.join('\n')}` : ''].filter(Boolean).join('\n\n'),
    daysPerWeek: weeklySplitLines.length || parsedDays.filter(day => day.exercises.length > 0).length || parsedDays.length,
    days: parsedDays,
  };
}
