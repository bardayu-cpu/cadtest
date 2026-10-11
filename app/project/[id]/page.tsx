import { ProjectEditor } from '@/components/ProjectEditor';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectEditor id={id} />;
}
