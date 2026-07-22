#!/usr/bin/env bash
# Shared path policy for the AgentForge monorepo.
# Allowed: phase<N>/, README/LICENSE, .github/, scripts/, .githooks/.

is_allowed_path() {
  local file="$1"
  [[ "$file" == "README.md" ]] && return 0
  [[ "$file" == "LICENSE" ]] && return 0
  [[ "$file" =~ ^phase[0-9]+/ ]] && return 0
  [[ "$file" =~ ^\.github/ ]] && return 0
  [[ "$file" =~ ^\.githooks/ ]] && return 0
  [[ "$file" =~ ^scripts/ ]] && return 0
  return 1
}

phase_only_check_files() {
  local violations=()
  local file

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if ! is_allowed_path "$file"; then
      violations+=("$file")
    fi
  done

  if [[ ${#violations[@]} -gt 0 ]]; then
    echo ""
    echo "ERROR: Only these paths may be committed or pushed:"
    echo "         phase<N>/   (phase1/, phase2/, ...)"
    echo "         README.md   (repo overview / publish status)"
    echo "         LICENSE     (MIT license)"
    echo "         .github/    (GitHub Actions / community files)"
    echo "         scripts/    (repo tooling)"
    echo "         .githooks/  (git hook enforcement)"
    echo ""
    echo "       The following paths are not allowed:"
    echo ""
    for file in "${violations[@]}"; do
      echo "  - $file"
    done
    echo ""
    echo "Move publishable code into a phase directory."
    echo "Keep local-only work (backend/, roadmap/, .cursorrules, etc.) untracked."
    echo ""
    return 1
  fi

  return 0
}

phase_only_check_stdin() {
  local files=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && files+=("$line")
  done
  if [[ ${#files[@]} -eq 0 ]]; then
    return 0
  fi
  printf '%s\n' "${files[@]}" | phase_only_check_files
}
