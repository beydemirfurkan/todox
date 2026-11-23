import type { ArrangedProjects, FolderGroup } from "@/lib/services/project-organization";

export interface ProjectGroupLabels {
  pinned: string;
  loose: string;
  archive: string;
  empty: string;
}

export interface RenderedFolder {
  id: number;
  name: string;
  node: React.ReactNode;
}

const inOrder = (folders: RenderedFolder[]) => folders.map((folder) => folder.node);

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
 * layout and is not remounted. `orderFolders` lets the sidebar hand the
 * rendered folders to its drag-to-reorder wrapper; elsewhere they are listed
 * as they come.
 */
export function ProjectGroups<P extends { id: number }>({
  arranged,
  renderRow,
  labels,
  listClassName,
  orderFolders = inOrder,
}: {
  arranged: ArrangedProjects<P>;
  renderRow: (project: P) => React.ReactNode;
  labels: ProjectGroupLabels;
  listClassName: string;
  orderFolders?: (folders: RenderedFolder[]) => React.ReactNode;
}) {
  const list = (projects: P[]) => <ul className={listClassName}>{projects.map(renderRow)}</ul>;
  const isArranged = arranged.pinned.length > 0 || arranged.folders.length > 0 || arranged.archived.length > 0;
  if (!isArranged) return list(arranged.loose);

  const folderNode = (folder: FolderGroup<P>) => (
    <details key={folder.id} open className="project-group">
      <summary className="project-group-head text-small text-muted">
        <span aria-hidden="true" className="project-group-caret" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="mono text-meta text-faint">{folder.projects.length}</span>
      </summary>
      {folder.projects.length > 0 ? (
        list(folder.projects)
      ) : (
        <p className="project-group-empty text-meta text-faint">{labels.empty}</p>
      )}
    </details>
  );

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
      {orderFolders(arranged.folders.map((folder) => ({ id: folder.id, name: folder.name, node: folderNode(folder) })))}
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
