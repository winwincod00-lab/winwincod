// src/lib/api-utils.ts
import prisma from "./prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { NextResponse } from "next/server";

export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return null;
  }
  // JWT role/activation can outlive an administrator's account change.
  const current = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, isActive: true } });
  if (!current?.isActive || current.role !== session.user.role) return null;
  return session.user;
}

export function errorResponse(message: string, status: number = 400) {
  return NextResponse.json({ error: message }, { status });
}