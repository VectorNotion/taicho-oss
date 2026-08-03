import { redirect } from 'next/navigation';

export default function LegacyTopicsPage() {
  redirect('/content/topics');
}
