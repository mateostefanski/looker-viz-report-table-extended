import { VisPluginTableModel } from './vis_table_plugin'
import * as d3 from './d3loader'

const themes = {
  traditional: require('./theme_traditional.css'),
  looker: require('./theme_looker.css'),
  contemporary: require('./theme_contemporary.css'),

  fixed: require('./layout_fixed.css'),
  auto: require('./layout_auto.css')
}

const removeStyles = async function() {
  try {
    const links = document.querySelectorAll('link[rel="stylesheet"]')
    links.forEach(link => {
      try { link.parentNode.removeChild(link) } catch(e) {}
    })
  } catch(e) {}
  Object.keys(themes).forEach(async (theme) => {
    try { await themes[theme].unuse() } catch(e) {}
  })
}

const loadStylesheet = function(link) {
  try {
    const linkElement = document.createElement('link')
    linkElement.setAttribute('rel', 'stylesheet')
    linkElement.setAttribute('href', link)
    document.getElementsByTagName('head')[0].appendChild(linkElement)
  } catch(e) {}
}

/**
 * Top N per Category configuration options (added on top of report table options)
 */
const topNConfigOptions = {
  topNEnabled: {
    section: "Top N",
    type: "boolean",
    label: "Enable Top N per Category",
    default: true,
    order: 0,
  },
  topNCount: {
    section: "Top N",
    type: "number",
    label: "Number of top items (N)",
    default: 10,
    order: 1,
  },
  topNSortDirection: {
    section: "Top N",
    type: "string",
    display: "select",
    label: "Sort Direction",
    values: [
      { 'Descending (Top)': 'desc' },
      { 'Ascending (Bottom)': 'asc' }
    ],
    default: "desc",
    order: 3,
  },
  topNShowOthers: {
    section: "Top N",
    type: "boolean",
    label: "Show 'Others' row per category",
    default: false,
    order: 4,
  },
  topNShowCategorySubtotal: {
    section: "Top N",
    type: "boolean",
    label: "Show category subtotal",
    default: true,
    order: 5,
  },
  topNShowRank: {
    section: "Top N",
    type: "boolean",
    label: "Show rank column",
    default: false,
    order: 6,
  },
}

/**
 * Filters data to keep only the top N rows per category (first dimension),
 * ranked by a selected measure.
 * 
 * @param {Array} data - Looker data rows
 * @param {Object} queryResponse - Looker query response
 * @param {Object} config - Visualization config
 * @returns {Object} { filteredData, categorySubtotals }
 */
function filterTopNPerCategory(data, queryResponse, config) {
  const dimensions = queryResponse.fields.dimension_like
  const measures = queryResponse.fields.measure_like

  if (dimensions.length < 1 || measures.length < 1) {
    return { filteredData: data, categoryTotals: {} }
  }

  const topN = config.topNCount || 10
  const sortDirection = config.topNSortDirection || 'desc'
  
  // Determine the ranking measure
  const rankMeasureName = config.topNRankMeasure || measures[0].name
  
  // First dimension = category, second dimension (if exists) = item within category
  const categoryDimName = dimensions[0].name
  
  // Group rows by category
  const groups = {}
  data.forEach(row => {
    const categoryValue = row[categoryDimName].value
    if (!groups[categoryValue]) {
      groups[categoryValue] = []
    }
    groups[categoryValue].push(row)
  })

  const filteredData = []
  const categoryTotals = {}

  Object.keys(groups).forEach(category => {
    const rows = groups[category]

    // Sort rows within category by the ranking measure
    rows.sort((a, b) => {
      const aVal = getMeasureValue(a, rankMeasureName, queryResponse)
      const bVal = getMeasureValue(b, rankMeasureName, queryResponse)
      if (aVal === null && bVal === null) return 0
      if (aVal === null) return 1
      if (bVal === null) return -1
      return sortDirection === 'desc' ? bVal - aVal : aVal - bVal
    })

    // Take top N
    const topRows = rows.slice(0, topN)
    const remainingRows = rows.slice(topN)

    filteredData.push(...topRows)

    // Calculate "Others" aggregate for remaining rows
    if (config.topNShowOthers && remainingRows.length > 0) {
      const othersRow = buildOthersRow(remainingRows, categoryDimName, category, measures, queryResponse)
      if (othersRow) {
        filteredData.push(othersRow)
      }
    }

    // Calculate category subtotals from ALL original rows (not just top N)
    if (config.topNShowCategorySubtotal) {
      categoryTotals[category] = buildCategoryTotal(rows, measures, queryResponse)
    }
  })

  return { filteredData, categoryTotals }
}

/**
 * Get the numeric value of a measure from a Looker data row, 
 * handling both pivoted and non-pivoted scenarios.
 */
function getMeasureValue(row, measureName, queryResponse) {
  const hasPivots = queryResponse.fields.pivots && queryResponse.fields.pivots.length > 0
  
  if (hasPivots) {
    // For pivoted data, sum across all pivot values for ranking purposes
    const pivotData = row[measureName]
    if (typeof pivotData === 'object' && pivotData !== null) {
      let total = 0
      let hasValue = false
      Object.keys(pivotData).forEach(pivotKey => {
        if (pivotKey !== '$$$_row_total_$$$') {
          const val = pivotData[pivotKey] ? pivotData[pivotKey].value : null
          if (val !== null && typeof val === 'number') {
            total += val
            hasValue = true
          }
        }
      })
      // Prefer row total if available
      if (pivotData['$$$_row_total_$$$'] && pivotData['$$$_row_total_$$$'].value !== null) {
        return pivotData['$$$_row_total_$$$'].value
      }
      return hasValue ? total : null
    }
    return null
  }
  
  const cell = row[measureName]
  if (cell && typeof cell.value === 'number') {
    return cell.value
  }
  return cell ? cell.value : null
}

/**
 * Build an "Others" summary row for the remaining items not in Top N
 */
function buildOthersRow(remainingRows, categoryDimName, category, measures, queryResponse) {
  if (remainingRows.length === 0) return null
  
  // Clone the structure from the first remaining row
  const othersRow = JSON.parse(JSON.stringify(remainingRows[0]))
  
  // Set dimension values - keep category, set item name to "Others (X items)"
  const dims = queryResponse.fields.dimension_like
  dims.forEach((dim, i) => {
    if (i === 0) {
      othersRow[dim.name] = { value: category, rendered: String(category) }
    } else {
      othersRow[dim.name] = { 
        value: `Others (${remainingRows.length} items)`, 
        rendered: `Others (${remainingRows.length} items)` 
      }
    }
  })

  // Sum up measure values
  const hasPivots = queryResponse.fields.pivots && queryResponse.fields.pivots.length > 0
  measures.forEach(measure => {
    if (hasPivots) {
      const pivotKeys = Object.keys(othersRow[measure.name] || {})
      pivotKeys.forEach(pivotKey => {
        let sum = 0
        let count = 0
        remainingRows.forEach(row => {
          if (row[measure.name] && row[measure.name][pivotKey]) {
            const val = row[measure.name][pivotKey].value
            if (typeof val === 'number') {
              sum += val
              count++
            }
          }
        })
        if (count > 0 && othersRow[measure.name][pivotKey]) {
          othersRow[measure.name][pivotKey].value = sum
          othersRow[measure.name][pivotKey].rendered = null  // let the vis reformat
          othersRow[measure.name][pivotKey].html = null
        }
      })
    } else {
      let sum = 0
      let count = 0
      remainingRows.forEach(row => {
        if (row[measure.name] && typeof row[measure.name].value === 'number') {
          sum += row[measure.name].value
          count++
        }
      })
      if (count > 0) {
        othersRow[measure.name] = { 
          value: sum, 
          rendered: null,
          html: null,
          links: []
        }
      }
    }
  })

  return othersRow
}

/**
 * Build category totals for all rows in a category
 */
function buildCategoryTotal(rows, measures, queryResponse) {
  const totals = {}
  const hasPivots = queryResponse.fields.pivots && queryResponse.fields.pivots.length > 0
  
  measures.forEach(measure => {
    if (hasPivots) {
      totals[measure.name] = {}
      const pivotKeys = Object.keys(rows[0][measure.name] || {})
      pivotKeys.forEach(pivotKey => {
        let sum = 0
        let count = 0
        rows.forEach(row => {
          if (row[measure.name] && row[measure.name][pivotKey]) {
            const val = row[measure.name][pivotKey].value
            if (typeof val === 'number') {
              sum += val
              count++
            }
          }
        })
        totals[measure.name][pivotKey] = { value: sum, count: count }
      })
    } else {
      let sum = 0
      let count = 0
      rows.forEach(row => {
        if (row[measure.name] && typeof row[measure.name].value === 'number') {
          sum += row[measure.name].value
          count++
        }
      })
      totals[measure.name] = { value: sum, count: count }
    }
  })
  
  return totals
}


// ---- TABLE RENDERING (adapted from report_table.js) ----

const buildTopNTable = function(config, dataTable, updateColumnOrder, element) {
  var dropTarget = null
  const bounds = element.getBoundingClientRect()
  const chartCentreX = bounds.x + (bounds.width / 2)
  const chartCentreY = bounds.y + (bounds.height / 2)

  removeStyles().then(() => {
    if (typeof config.customTheme !== 'undefined' && config.customTheme && config.theme === 'custom') {
      loadStylesheet(config.customTheme)
    } else if (typeof themes[config.theme] !== 'undefined') {
      themes[config.theme].use()
    }
    if (typeof themes[config.layout] !== 'undefined') {
      themes[config.layout].use()
    }
  })

  const renderTable = async function() {
    const getTextWidth = function(text, font = '') {
      var canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement('canvas'))
      var context = canvas.getContext('2d')
      context.font = font || config.bodyFontSize + 'pt arial'
      var metrics = context.measureText(text)
      return metrics.width
    }

    var table = d3.select('#visContainer')
      .append('table')
        .attr('id', 'reportTable')
        .attr('class', 'reportTable topNTable')
        .style('opacity', 0)

    var drag = d3.drag()
      .on('start', (source, idx) => {
        if (!dataTable.has_pivots && source.colspan === 1) {
          var xPosition = parseFloat(d3.event.x)
          var yPosition = parseFloat(d3.event.y)
          var html = source.column.getHeaderCellLabelByType('field')
          d3.select("#tooltip")
              .style("left", xPosition + "px")
              .style("top", yPosition + "px")                     
              .html(html)
          d3.select("#tooltip").classed("hidden", false)
        }
      })
      .on('drag', (source, idx) => {
        if (!dataTable.has_pivots) {
          d3.select("#tooltip") 
            .style("left", d3.event.x + "px")
            .style("top", d3.event.y + "px")  
        }
      })
      .on('end', (source, idx) => {
        if (!dataTable.has_pivots) {
          d3.select("#tooltip").classed("hidden", true)
          var movingColumn = source.column
          var targetColumn = dropTarget.column
          var movingIdx = Math.floor(movingColumn.pos/10) * 10
          var targetIdx = Math.floor(targetColumn.pos/10) * 10
          dataTable.moveColumns(movingIdx, targetIdx, updateColumnOrder)
        }
      })
    
    if (dataTable.minWidthForIndexColumns) {
      var columnTextWidths = {}
      if (!dataTable.transposeTable) {
        dataTable.column_series.filter(cs => !cs.column.hide).filter(cs => cs.column.modelField.type === 'dimension').forEach(cs => {
          var maxLength = cs.series.values.reduce((a, b) => Math.max(getTextWidth(a), getTextWidth(b)))
          var columnId = cs.column.modelField.name
          if (dataTable.useIndexColumn) {
            columnId = '$$$_index_$$$'
            maxLength += 15
          }
          columnTextWidths[columnId] = Math.ceil(maxLength)
        })
      } else {
        dataTable.headers.forEach(header => {
          var fontSize = 'bold ' + config.bodyFontSize + 'pt arial'
          var maxLength = dataTable.transposed_data
            .map(row => row.data[header.type].rendered)
            .reduce((a, b) => Math.max(getTextWidth(a, fontSize), getTextWidth(b, fontSize)))
          columnTextWidths[header.type] = Math.ceil(maxLength)
        })
      }
    }
    
    var column_groups = table.selectAll('colgroup')
      .data(dataTable.getTableColumnGroups()).enter()  
        .append('colgroup')

    column_groups.selectAll('col')
      .data(d => d).enter()
        .append('col')
        .attr('id', d => ['col',d.id].join('').replace('.', '') )
        .attr('span', 1)
        .style('width', d => {
          if (dataTable.minWidthForIndexColumns && d.type === 'index' && typeof columnTextWidths[d.id] !== 'undefined') {
            return columnTextWidths[d.id] + 'px'
          } else {
            return ''
          }
        })

    var header_rows = table.append('thead')
      .selectAll('tr')
      .data(dataTable.getHeaderTiers()).enter() 

    var header_cells = header_rows.append('tr')
      .selectAll('th')
      .data((level, i) => dataTable.getTableHeaderCells(i).map(column => column.levels[i]))
        .enter()    

    header_cells.append('th')
      .text(d => d.label)
      .attr('id', d => d.id)
      .attr('colspan', d => d.colspan)
      .attr('rowspan', d => d.rowspan)
      .attr('class', d => {
        var classes = ['reportTable']
        if (typeof d.cell_style !== 'undefined') { classes = classes.concat(d.cell_style) }
        return classes.join(' ')
      })
      .style('text-align', d => d.align)
      .style('font-size', config.headerFontSize + 'px')
      .attr('draggable', true)
      .call(drag)
      .on('mouseover', cell => dropTarget = cell)
      .on('mouseout', () => dropTarget = null)

    var table_rows = table.append('tbody')
      .selectAll('tr')
      .data(dataTable.getDataRows()).enter()
        .append('tr')
        .on('mouseover', function() { 
          if (dataTable.showHighlight) {
            this.classList.toggle('hover') 
          }
        })
        .on('mouseout', function() { 
          if (dataTable.showHighlight) {
            this.classList.toggle('hover') 
          }
        })
        .selectAll('td')
        .data(row => dataTable.getTableRowColumns(row).map(column => row.data[column.id]))
          .enter()

    table_rows.append('td')
      .text(d => {
        var text = ''
        if (Array.isArray(d.value)) {
          text = !(d.rendered === null) ? d.rendered : d.value.join(' ')
        } else if (typeof d.value === 'object' && d.value !== null && typeof d.value.series !== 'undefined') {
          text = null
        } else if (d.html) {
          var parser = new DOMParser()
          var parsed_html = parser.parseFromString(d.html, 'text/html')
          text = parsed_html.documentElement.textContent
        } else if (d.rendered || d.rendered === '') {
          text = d.rendered
        } else {
          text = d.value   
        }
        text = String(text)
        return text ? text.replace('-', '\u2011') : text
      }) 
      .attr('rowspan', d => d.rowspan)
      .attr('colspan', d => d.colspan)
      .style('text-align', d => d.align)
      .style('font-size', config.bodyFontSize + 'px')
      .attr('class', d => {
        var classes = ['reportTable']
        if (typeof d.value === 'object') { classes.push('cellSeries') }
        if (typeof d.align !== 'undefined') { classes.push(d.align) }
        if (typeof d.cell_style !== 'undefined') { classes = classes.concat(d.cell_style) }
        return classes.join(' ')
      })
      .on('mouseover', d => {
        if (dataTable.showHighlight) {
          if (!dataTable.transposeTable) {
            var id = ['col', d.colid].join('').replace('.', '')
          } else {
            var id = ['col', d.rowid].join('').replace('.', '')
          }
          var colElement = document.getElementById(id)
          if (colElement) colElement.classList.toggle('hover')
        }
        
        if (dataTable.showTooltip && d.cell_style.includes('measure')) {
          var x = d3.event.clientX
          var y = d3.event.clientY
          var html = dataTable.getCellToolTip(d.rowid, d.colid)
          d3.select("#tooltip")
            .style('left', x + 'px')
            .style('top', y + 'px')                   
            .html(html)
          d3.select("#tooltip").classed("hidden", false)
        }
      })
      .on('mousemove', d => {
        if (dataTable.showTooltip && d.cell_style.includes('measure')) {
          var tooltip = d3.select('#tooltip')
          var x = d3.event.clientX < chartCentreX ? d3.event.pageX + 10 : d3.event.pageX - tooltip.node().getBoundingClientRect().width - 10
          var y = d3.event.clientY < chartCentreY ? d3.event.pageY + 10 : d3.event.pageY - tooltip.node().getBoundingClientRect().height - 10
          tooltip
              .style('left', x + 'px')
              .style('top', y + 'px')
        }
      })
      .on('mouseout', d => {
        if (dataTable.showHighlight) {
          if (!dataTable.transposeTable) {
            var id = ['col', d.colid].join('').replace('.', '')
          } else {
            var id = ['col', d.rowid].join('').replace('.', '')
          }
          var colElement = document.getElementById(id)
          if (colElement) colElement.classList.toggle('hover')
        }
        if (dataTable.showTooltip && d.cell_style.includes('measure')) {
          d3.select("#tooltip").classed("hidden", true)
        }
      })
      .on('click', d => {
        let event = {
          metaKey: d3.event.metaKey,
          pageX: d3.event.pageX,
          pageY: d3.event.pageY - window.pageYOffset
        }
        LookerCharts.Utils.openDrillMenu({
          links: d.links,
          event: event
        })
      })
  }

  renderTable().then(() => {
    document.getElementById('reportTable').classList.add('reveal')
    document.getElementById('visSvg').classList.add('hidden')
    document.getElementById('reportTable').style.opacity = 1
  })
}

// ---- LOOKER VISUALIZATION REGISTRATION ----

looker.plugins.visualizations.add({
  options: (function() { 
    let ops = VisPluginTableModel.getCoreConfigOptions()
    ops.theme.values.pop()  // remove custom theme
    delete ops.customTheme
    // Merge Top N options
    Object.assign(ops, topNConfigOptions)
    return ops
  })(),
  
  create: function(element, config) {
    this.svgContainer = d3.select(element)
      .append("div")
      .attr("id", "visSvg")
      .attr("width", element.clientWidth)
      .attr("height", element.clientHeight)

    this.tooltip = d3.select(element)
      .append("div")
      .attr("id", "tooltip")
      .attr("class", "hidden")
  },

  updateAsync: function(data, element, config, queryResponse, details, done) {
    const updateColumnOrder = newOrder => {
      this.trigger('updateConfig', [{ columnOrder: newOrder }])
    }

    // ERROR HANDLING
    this.clearErrors()

    if (queryResponse.fields.pivots.length > 2) {
      this.addError({
        title: 'Max Two Pivots',
        message: 'This visualization accepts no more than 2 pivot fields.'
      })
      return
    }

    if (queryResponse.fields.dimension_like.length < 1) {
      this.addError({
        title: 'Dimension Required',
        message: 'This visualization requires at least one dimension (category field).'
      })
      return
    }

    if (queryResponse.fields.measure_like.length < 1) {
      this.addError({
        title: 'Measure Required',
        message: 'This visualization requires at least one measure to rank by.'
      })
      return
    }

    // INITIALISE
    try {
      var elem = document.querySelector('#visContainer')
      elem.parentNode.removeChild(elem)  
    } catch(e) {}    

    this.container = d3.select(element)
      .append('div')
      .attr('id', 'visContainer')

    if (typeof config.columnOrder === 'undefined') {
      this.trigger('updateConfig', [{ columnOrder: {} }])
    }

    // APPLY TOP N FILTERING
    let processedData = data
    const topNEnabled = typeof config.topNEnabled !== 'undefined' ? config.topNEnabled : true

    if (topNEnabled && queryResponse.fields.dimension_like.length >= 1) {
      const result = filterTopNPerCategory(data, queryResponse, config)
      processedData = result.filteredData
    }

    // BUILD THE VIS
    var dataTable = new VisPluginTableModel(processedData, queryResponse, config)
    
    // Register dynamic options including the rank measure selector
    var configOptions = dataTable.getConfigOptions()
    
    // Add the rank measure selector dynamically based on available measures
    var measureOptions = []
    queryResponse.fields.measure_like.forEach(measure => {
      var option = {}
      option[measure.label_short || measure.label] = measure.name
      measureOptions.push(option)
    })
    
    // Also add supermeasures if present
    if (queryResponse.fields.supermeasure_like) {
      queryResponse.fields.supermeasure_like.forEach(measure => {
        var option = {}
        option[measure.label_short || measure.label] = measure.name
        measureOptions.push(option)
      })
    }

    configOptions['topNRankMeasure'] = {
      section: 'Top N',
      type: 'string',
      display: 'select',
      label: 'Rank by Measure',
      values: measureOptions,
      default: queryResponse.fields.measure_like[0].name,
      order: 2,
    }

    this.trigger('registerOptions', configOptions)
    buildTopNTable(config, dataTable, updateColumnOrder, element)
    
    done()
  }
})
