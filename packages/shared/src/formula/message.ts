import { FORMULA_FUNCTIONS, FORMULA_MAX_LENGTH, type FormulaProblem, type FormulaProblemCode } from './types';

/**
 * Every problem in plain English, for someone who is not a programmer. `{name}` and `{other}` are filled from
 * the problem. The web app has the same sentences in English and Hindi (`formula.p.*`); a test keeps them in step.
 */
export const FORMULA_MESSAGES: Record<FormulaProblemCode, string> = {
  empty: 'Write the formula, for example: qty × rate',
  tooLong: `This formula is too long (${FORMULA_MAX_LENGTH} characters at most). Split it into two formula fields.`,
  tooDeep: 'Too many brackets inside each other. Split the formula into two formula fields.',
  badChar: 'A formula can\'t use "{name}". Use field names, numbers and + − × ÷ % ( ).',
  badNumber: '"{name}" is not a number. Write it like 1200 or 12.5, without commas.',
  openText: 'The text in quotes is never closed. Add the closing quote.',
  missingAfter: 'Something is missing after "{name}".',
  missingBefore: 'Something is missing before "{name}".',
  missingBetween: 'Something is missing between "{name}" and "{other}". Put + − × or ÷ there.',
  openBracket: 'This bracket is never closed. Add a ) at the end.',
  closeBracket: 'This ) has no ( before it.',
  emptyBrackets: 'There is nothing inside these brackets.',
  comma:
    'A comma only goes between the values of a function, like min(a, b). Write decimals with a point: 12.5',
  unknownFunction: `There is no function called "{name}". You can use: ${FORMULA_FUNCTIONS.join(', ')}.`,
  usage: '"{name}" is written like this: {other}',
  sumColumn: "sum can add up 'amount', 'qty' or 'rate' of the item lines, not \"{name}\".",
  unknownField: 'There is no field called "{name}" here. Pick a field from the list.',
  needsBrackets: '"{name}" is a function. Write it like this: {other}',
  self: 'A formula can\'t use its own field ("{name}").',
  cycle: 'This formula uses "{name}", and "{name}" uses this field back. One of them has to change.',
  fieldType:
    '"{name}" can\'t be used in a formula. Use number, amount, date, yes/no, choice or item-line fields.',
  itemsOutside: 'Item lines can only be used inside sum( ) or count( ), like sum({name}).',
  needsItems: '{name}( ) needs a field with item lines.',
  needsNumber: '"{name}" is not a number, so it can\'t be used in a sum.',
  needsDates: '"{name}" needs two dates: {other}',
  dateMath:
    "Dates can't be used like this. You can add or take away days (date + 2) or take one date from another (to − from).",
  condition: 'if( ) starts with a question, like this: if(a > b, x, y)',
  compare: 'This compares two things, which gives yes or no. Put it inside if( ), like this: if(a > b, x, y)',
  textCompare: 'Text and yes/no can only be checked with = or ≠.',
  sameKind:
    '"{name}" and "{other}" are different kinds of value (number, date, text), so they can\'t go together here.',
  result: 'A formula must give a number or a date. This one gives text or yes/no.',
};

/** The problem as one sentence. */
export function formulaMessage(p: FormulaProblem): string {
  return FORMULA_MESSAGES[p.code].replaceAll('{name}', p.name ?? '').replaceAll('{other}', p.other ?? '');
}
