import type { ArrangedProjects, FolderGroup } from "@/lib/services/project-organization";

export interface ProjectGroupLabels {
  pinned: string;
  loose: string;
  archive: string;
  empty: string;
}

/** Something already rendered, with what a reorderer needs to know about it. */
export interface RenderedItem {
  id: number;
  name: string;
  node: React.ReactNode;
}

/**
 * A person's projects as they arranged them: pinned, their folders, the rest,
 * and the archive folded shut. The same groups in the sidebar and in the list
 * Today shows on a phone, so a project is where you put it in both.
 *
 * With nothing arranged it is the plain list it always was, with no headings
 * -- somebody who never made a folder should not meet an empty "pinned".
 *
 * Folders are `<details>`: they fold with no script, and the browser keeps a
 * folded one folded across navigations, because the sidebar lives in the
 * layout and is not remounted.
 *
 * `renderRow` draws a row's content and this wraps it in the `<li>`, because a
 * reorderable list has to own its own list items. `sortFolders` and
 * `sortProjects` are where a caller hands the rendered pieces to a reorderer;
 * without them they are listed as they come.
 */
export function ProjectGroups<P extends { id: number; name: string }>({
  arranged,
  renderRow,
  labels,
  listClassName,
  sortFolders,
  sortProjects,
}: {
  arranged: ArrangedProjects<P>;
  renderRow: (project: P) => React.ReactNode;
  labels: ProjectGroupLabels;
  listClassName: string;
  sortFolders?: (folders: RenderedItem[]) => React.ReactNode;
  sortProjects?: (folderId: number, projects: RenderedItem[]) => React.ReactNode;
}) {
  const list = (projects: P[]) => (
    <ul className={listClassName}>
      {projects.map((project) => (
        <li key={project.id}>{renderRow(project)}</li>
      ))}
    </ul>
  );
  const isArranged = arranged.pinned.length > 0 || arranged.folders.length > 0 || arranged.archived.length > 0;
  if (!isArranged) return list(arranged.loose);

  const folderContents = (folder: FolderGroup<P>) => {
    if (folder.projects.length === 0)
      return <p className="project-group-empty text-meta text-faint">{labels.empty}</p>;
    // One project has no order to change.
    if (!sortProjects || folder.projects.length < 2) return list(folder.projects);
    return sortProjects(
      folder.id,
      folder.projects.map((project) => ({ id: project.id, name: project.name, node: renderRow(project) })),
    );
  };

  const folderNode = (folder: FolderGroup<P>) => (
    <details key={folder.id} open className="project-group">
      <summary className="project-group-head text-small text-muted">
        <span aria-hidden="true" className="project-group-caret" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="mono text-meta text-faint">{folder.projects.length}</span>
      </summary>
      {folderContents(folder)}
    </details>
  );

  const folders = arranged.folders.map((folder) => ({ id: folder.id, name: folder.name, node: folderNode(folder) }));

  return (
    <div className="project-groups">
      {arranged.pinned.length > 0 && (
        <section aria-label={labels.pinned}>
          <p className="project-group-head text-meta text-faint" aria-hidden="true">
            {labels.pinned}
          </p>
          {list(arranged.pinned)}
        </section>
      )}
      {sortFolders && folders.length > 1 ? sortFolders(folders) : folders.map((folder) => folder.node)}
      {arranged.loose.length > 0 && (
        <section aria-label={labels.loose}>
          <p className="project-group-head text-meta text-faint" aria-hidden="true">
            {labels.loose}
          </p>
          {list(arranged.loose)}
        </section>
      )}
      {arranged.archived.length > 0 && (
        <details className="project-group">
          <summary className="project-group-head text-small text-muted">
            <span aria-hidden="true" className="project-group-caret" />
            <span className="min-w-0 flex-1 truncate">{labels.archive}</span>
            <span className="mono text-meta text-faint">{arranged.archived.length}</span>
          </summary>
          {list(arranged.archived)}
        </details>
      )}
    </div>
  );
}
