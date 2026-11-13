import { NextResponse } from 'next/server';

// Die Anmeldung ist ein Bearer-Token im Browser; Abmelden heisst, es dort zu verwerfen.
export async function POST() {
  return NextResponse.json({ message: 'Erfolgreich abgemeldet.' }, { headers: { 'cache-control': 'no-store' } });
}
