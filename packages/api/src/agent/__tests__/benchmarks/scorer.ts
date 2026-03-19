/**
 * LLM-as-judge scorer.
 *
 * Calls the model to rate a response on quality dimensions.
 * Using the same model creates some self-serving bias, but it's still
 * very useful for *relative* comparisons (did the prompt change help or hurt?).
 */

import { generateText } from 'ai';
import { getModel } from '../../agent.js';

export interface ScoreDimensions {
  /** Does the response directly answer the question asked? (1-5) */
  relevance: number;
  /** Does it give concrete, specific, actionable advice? (1-5) */
  actionability: number;
  /** Does it cite actual numbers from the user's data? (1-5) */
  use_of_data: number;
  /** Is it well-structured and easy to read? (1-5) */
  clarity: number;
  /** Does it cover the key aspects without being bloated? (1-5) */
  completeness: number;
  /** Overall quality (1-5) */
  overall: number;
  /** One-sentence explanation of the overall score */
  reasoning: string;
}

export interface ScoredResponse {
  scores: ScoreDimensions;
  /** Weighted total out of 100 */
  total: number;
}

const SCORE_SYSTEM = `You are an expert evaluator of AI financial assistant responses.
Score the response strictly and objectively. Use the full range 1-5, not just 3-5.

1 = Poor: fails at this dimension entirely
2 = Below average: partially succeeds but has notable gaps
3 = Average: meets basic expectations
4 = Good: clearly above average
5 = Excellent: best possible for this type of query

Return ONLY valid JSON, no markdown, no explanation outside the JSON:
{
  "relevance": <1-5>,
  "actionability": <1-5>,
  "use_of_data": <1-5>,
  "clarity": <1-5>,
  "completeness": <1-5>,
  "overall": <1-5>,
  "reasoning": "<one sentence>"
}`;

function buildScoringPrompt(question: string, response: string): string {
  return `USER QUESTION:
${question}

AI RESPONSE TO EVALUATE:
${response.slice(0, 4000)}${response.length > 4000 ? '\n[truncated]' : ''}

Score this response on the 5 dimensions.`;
}

export async function scoreResponse(
  question: string,
  response: string,
): Promise<ScoredResponse> {
  if (!response || response.length < 10) {
    return emptyScore('Response was empty or too short');
  }

  try {
    const result = await generateText({
      model: getModel(),
      system: SCORE_SYSTEM,
      messages: [{ role: 'user', content: buildScoringPrompt(question, response) }],
    });

    // Strip markdown fences if the model wrapped the JSON
    const raw = result.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(raw) as ScoreDimensions;

    // Validate all fields are present and in range
    const dims: Array<keyof Omit<ScoreDimensions, 'reasoning'>> = [
      'relevance', 'actionability', 'use_of_data', 'clarity', 'completeness', 'overall',
    ];
    for (const dim of dims) {
      if (typeof parsed[dim] !== 'number' || parsed[dim] < 1 || parsed[dim] > 5) {
        throw new Error(`Invalid score for ${dim}: ${parsed[dim]}`);
      }
    }

    // Weighted total out of 100:
    // overall × 2 weighted heavier, rest equal weight
    const total = Math.round(
      (parsed.relevance + parsed.actionability + parsed.use_of_data + parsed.clarity + parsed.completeness + parsed.overall * 2) / 7 * 20
    );

    return { scores: parsed, total };
  } catch (e) {
    return emptyScore(`Scoring failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function emptyScore(reason: string): ScoredResponse {
  return {
    scores: {
      relevance: 0, actionability: 0, use_of_data: 0,
      clarity: 0, completeness: 0, overall: 0,
      reasoning: reason,
    },
    total: 0,
  };
}
