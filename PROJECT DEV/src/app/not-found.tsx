import Link from 'next/link';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { ArrowLeft, Terminal } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full rounded border border-toxic-border bg-surface p-8 space-y-5">
        <div className="flex justify-center">
          <HexCubeLogo size={42} />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-toxic-bg border border-toxic-border text-toxic font-mono text-xs font-bold uppercase">
          <Terminal className="w-4 h-4" />
          <span>404 // ROUTE NOT FOUND</span>
        </div>

        <h2 className="font-sans font-extrabold text-xl text-white uppercase tracking-tight">
          Sector Out of Bounds
        </h2>

        <p className="font-sans text-xs text-muted leading-relaxed">
          The requested path is not recognized by the TrenchLabs operating node.
        </p>

        <Link
          href="/"
          className="w-full h-11 px-5 rounded bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
          <span>RETURN TO BASE</span>
        </Link>
      </div>
    </div>
  );
}

