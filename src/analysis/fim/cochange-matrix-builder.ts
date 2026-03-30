import type { CommitRecord } from '@/cli/git-history/git-log-reader.js';

function buildPresenceSets(commits: CommitRecord[]): Map<string, Set<string>> {
  const presence = new Map<string, Set<string>>();

  for (const commit of commits) {
    const uniquePaths = new Set(commit.files.map((file) => file.path.replace(/\\/g, '/')));
    for (const filePath of uniquePaths) {
      if (!presence.has(filePath)) {
        presence.set(filePath, new Set());
      }
      presence.get(filePath)?.add(commit.sha);
    }
  }

  return presence;
}

function jaccard(left: Set<string> | undefined, right: Set<string> | undefined): number {
  const leftSize = left?.size ?? 0;
  const rightSize = right?.size ?? 0;
  if (leftSize === 0 || rightSize === 0) {
    return 0;
  }

  let joint = 0;
  const smaller = leftSize <= rightSize ? left : right;
  const larger = smaller === left ? right : left;
  for (const value of smaller ?? []) {
    if (larger?.has(value)) {
      joint++;
    }
  }

  const union = leftSize + rightSize - joint;
  return union > 0 ? joint / union : 0;
}

export function buildFullCochangeMatrix(commits: CommitRecord[], fileIds: string[]): number[][] {
  const presence = buildPresenceSets(commits);
  const normalizedFileIds = fileIds.map((fileId) => fileId.replace(/\\/g, '/'));

  return normalizedFileIds.map((fileId, rowIndex) =>
    normalizedFileIds.map((otherFileId, columnIndex) => {
      if (rowIndex === columnIndex) {
        return (presence.get(fileId)?.size ?? 0) > 0 ? 1 : 0;
      }
      return jaccard(presence.get(fileId), presence.get(otherFileId));
    })
  );
}

export function buildPackageCochangeMatrix(
  commits: CommitRecord[],
  packageNames: string[],
  fileToPackage: Map<string, string>
): number[][] {
  const packageCommits = new Map<string, Set<string>>();
  for (const packageName of packageNames) {
    packageCommits.set(packageName, new Set());
  }

  for (const commit of commits) {
    const touchedPackages = new Set<string>();
    for (const file of commit.files) {
      const filePath = file.path.replace(/\\/g, '/');
      const packageName = fileToPackage.get(filePath);
      if (packageName) {
        touchedPackages.add(packageName);
      }
    }

    for (const packageName of touchedPackages) {
      packageCommits.get(packageName)?.add(commit.sha);
    }
  }

  return packageNames.map((packageName, rowIndex) =>
    packageNames.map((otherPackageName, columnIndex) => {
      if (rowIndex === columnIndex) {
        return (packageCommits.get(packageName)?.size ?? 0) > 0 ? 1 : 0;
      }
      return jaccard(packageCommits.get(packageName), packageCommits.get(otherPackageName));
    })
  );
}
