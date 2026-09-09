/**
 * Branded identifiers. Every ID in AIWC is a string at runtime; the brand only exists at
 * type level so a ThreadId can never be passed where a TurnId is expected.
 */
import { nanoid } from 'nanoid'

declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type ThreadId = Brand<string, 'ThreadId'>
export type TurnId = Brand<string, 'TurnId'>
export type StepId = Brand<string, 'StepId'>
export type ItemId = Brand<string, 'ItemId'>
export type CallId = Brand<string, 'CallId'>
export type ApprovalId = Brand<string, 'ApprovalId'>
export type SessionKey = Brand<string, 'SessionKey'>

export const newThreadId = (): ThreadId => `thr_${nanoid(12)}` as ThreadId
export const newTurnId = (): TurnId => `trn_${nanoid(12)}` as TurnId
export const newStepId = (): StepId => `stp_${nanoid(10)}` as StepId
export const newItemId = (): ItemId => `itm_${nanoid(12)}` as ItemId
export const newCallId = (): CallId => `cal_${nanoid(12)}` as CallId
export const newApprovalId = (): ApprovalId => `apr_${nanoid(10)}` as ApprovalId
export const asThreadId = (s: string): ThreadId => s as ThreadId
export const asTurnId = (s: string): TurnId => s as TurnId
export const asItemId = (s: string): ItemId => s as ItemId
export const asCallId = (s: string): CallId => s as CallId

/** Millisecond epoch. */
export type Millis = number
export const now = (): Millis => Date.now()

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue }
