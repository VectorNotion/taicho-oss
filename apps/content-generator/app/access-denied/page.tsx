import Link from "next/link";

export default function AccessDeniedPage() {
  return <div className="mx-auto max-w-lg py-24 text-center"><p className="text-sm font-semibold text-muted-foreground">403</p><h1 className="mt-3 text-3xl font-semibold">Content access required</h1><p className="mt-3 text-muted-foreground">Your organization or assigned role does not permit access to this product.</p><Link className="mt-8 inline-block underline" href="/">Return</Link></div>;
}
