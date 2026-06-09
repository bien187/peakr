import { NextResponse } from 'next/server';

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status });
export const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });
