project_name: "viz-top-n-table"

constant: VIS_LABEL {
  value: "Table (Top N per Category)"
  export: override_optional
}

constant: VIS_ID {
  value: "top_n_table"
  export: override_optional
}

visualization: {
  id: "@{VIS_ID}"
  url: "https://cdn.jsdelivr.net/gh/mateostefanski/looker-viz-report-table-extended@main/top_n_table.js"
  label: "@{VIS_LABEL}"
}
