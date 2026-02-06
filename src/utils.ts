
// --- Helper Functions for XML Parsing ---

import { AIAction, SubGoal } from "./type";

export function extractXMLTag(xmlString: string, tagName: string): string | undefined {
  const lowerXmlString = xmlString.toLowerCase();
  const lowerTagName = tagName.toLowerCase();
  const closeTag = `</${lowerTagName}>`;
  const openTag = `<${lowerTagName}>`;

  const lastCloseIndex = lowerXmlString.lastIndexOf(closeTag);
  if (lastCloseIndex === -1) return undefined;

  const searchArea = lowerXmlString.substring(0, lastCloseIndex);
  const lastOpenIndex = searchArea.lastIndexOf(openTag);
  if (lastOpenIndex === -1) return undefined;

  const contentStart = lastOpenIndex + openTag.length;
  const contentEnd = lastCloseIndex;
  return xmlString.substring(contentStart, contentEnd).trim();
}

function safeParseJson(jsonStr: string) {
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    return undefined;
  }
}

export function parseSubGoalsFromXML(xmlContent: string): SubGoal[] {
  const subGoals: SubGoal[] = [];
  const regex = /<sub-goal\s+index="(\d+)"\s+status="(pending|finished)"(?:\s*\/>|>([\s\S]*?)<\/sub-goal>)/gi;
  let match: RegExpExecArray | null;

  // Note: Since we are matching global, we need to reset lastIndex if reusing regex, or just loop
  while ((match = regex.exec(xmlContent)) !== null) {
      const index = parseInt(match[1], 10);
      const status = match[2] as 'pending' | 'finished';
      const description = match[3]?.trim() || '';
      // Default to running if it's the first pending? Core logic handles "pending -> running".
      // Here we just parse what the AI gave.
      subGoals.push({ index, status, description });
  }
  return subGoals;
}

function parseMarkFinishedIndexes(xmlContent: string): number[] {
  const indexes: number[] = [];
  const regex = /<sub-goal\s+index="(\d+)"\s+status="finished"\s*\/>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xmlContent)) !== null) {
    indexes.push(parseInt(match[1], 10));
  }
  return indexes;
}

export function parseXMLPlanningResponse(xmlString: string): AIAction {
  const thought = extractXMLTag(xmlString, 'thought');
  const log = extractXMLTag(xmlString, 'log');
  const error = extractXMLTag(xmlString, 'error');
  const actionType = extractXMLTag(xmlString, 'action-type');
  const actionParamStr = extractXMLTag(xmlString, 'action-param-json');

  const completeGoalRegex = /<complete-goal\s+success="(true|false)">([\s\S]*?)<\/complete-goal>/i;
  const completeGoalMatch = xmlString.match(completeGoalRegex);

  let finalizeMessage: string | undefined;
  let finalizeSuccess: boolean | undefined;

  if (completeGoalMatch) {
    finalizeSuccess = completeGoalMatch[1] === 'true';
    finalizeMessage = completeGoalMatch[2]?.trim();
  }

  // Parse Sub-goal related tags
  const updatePlanContent = extractXMLTag(xmlString, 'update-plan-content');
  const markSubGoalDone = extractXMLTag(xmlString, 'mark-sub-goal-done');
  const memory = extractXMLTag(xmlString, 'memory');

  const updateSubGoals = updatePlanContent ? parseSubGoalsFromXML(updatePlanContent) : undefined;
  const markFinishedIndexes = markSubGoalDone ? parseMarkFinishedIndexes(markSubGoalDone) : undefined;

  let action: any = null;
  // If we have an explicit action type provided by the model
  if (actionType && actionType.toLowerCase() !== 'null') {
    const type = actionType.trim();
    let param: any = undefined;
    if (actionParamStr) {
       param = safeParseJson(actionParamStr);
    }
    action = { type, param };
  }

  return {
    thought,
    log,
    error,
    ...(action ? { type: action.type, param: action.param } : { type: 'null' }),
    finalizeMessage,
    finalizeSuccess,
    updateSubGoals,
    markFinishedIndexes,
    memory
  };
}

export async function waitFor(millSeconds: number) {
  await new Promise(r => setTimeout(r, millSeconds));
}
