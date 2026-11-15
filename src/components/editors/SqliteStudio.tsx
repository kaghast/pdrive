import * as Dialog from '@radix-ui/react-dialog';
import CodeMirror from '@uiw/react-codemirror';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import initSqlJs, { Database as SqlJsDatabase, QueryExecResult, SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { formatBytes } from '../../lib/utils';
import { CloudFile } from '../../providers/StorageProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface SqliteStudioProps {
  file?: CloudFile;
  targetFolderId?: string;
}

interface TableSummary {
  name: string;
  type: 'table' | 'view';
  sql: string;
  rowCount: number;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface NewColumnDraft {
  name: string;
  type: 'INTEGER' | 'TEXT' | 'REAL' | 'BLOB' | 'NUMERIC';
  pk: boolean;
  autoincrement: boolean;
  notNull: boolean;
  unique: boolean;
  defaultValue: string;
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: () => wasmUrl,
    });
  }
  return sqlJsPromise;
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function escapeSqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (val instanceof Uint8Array) {
    const hex = Array.from(val)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `X'${hex}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

export const SqliteStudio: React.FC<SqliteStudioProps> = ({ file, targetFolderId }) => {
  const { storageProvider, settings, currentFolderId, triggerExplorerRefresh } = useDriveOS();

  const dbRef = useRef<SqlJsDatabase | null>(null);
  const [activeFile, setActiveFile] = useState<CloudFile | undefined>(file);
  const [fileName, setFileName] = useState(file?.name || 'database.sqlite');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dbSizeBytes, setDbSizeBytes] = useState(0);

  const [tables, setTables] = useState<TableSummary[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [activeTab, setActiveTab] = useState<'browse' | 'sql' | 'structure'>('browse');
  const [mobileTablesOpen, setMobileTablesOpen] = useState(false);

  // Browse state
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [rowIds, setRowIds] = useState<number[]>([]);
  const [hasRowId, setHasRowId] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [totalRows, setTotalRows] = useState(0);
  const [rowSearch, setRowSearch] = useState('');

  // Inline / Modal Row Edit & Insert
  const [insertModalOpen, setInsertModalOpen] = useState(false);
  const [insertValues, setInsertValues] = useState<Record<string, { value: string; isNull: boolean }>>({});
  const [editingRow, setEditingRow] = useState<{
    rowid: number;
    values: Record<string, { value: string; isNull: boolean }>;
  } | null>(null);
  const [deleteRowTarget, setDeleteRowTarget] = useState<number | null>(null);

  // Create Table Modal
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [newTableName, setNewTableName] = useState('items');
  const [newTableCols, setNewTableCols] = useState<NewColumnDraft[]>([
    {
      name: 'id',
      type: 'INTEGER',
      pk: true,
      autoincrement: true,
      notNull: true,
      unique: false,
      defaultValue: '',
    },
    {
      name: 'title',
      type: 'TEXT',
      pk: false,
      autoincrement: false,
      notNull: true,
      unique: false,
      defaultValue: '',
    },
    {
      name: 'created_at',
      type: 'TEXT',
      pk: false,
      autoincrement: false,
      notNull: false,
      unique: false,
      defaultValue: "CURRENT_TIMESTAMP",
    },
  ]);

  // Add column in Structure tab
  const [addColName, setAddColName] = useState('');
  const [addColType, setAddColType] = useState<'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'NUMERIC'>('TEXT');
  const [addColDefault, setAddColDefault] = useState('');

  // SQL Console state
  const [sqlInput, setSqlInput] = useState(
    '-- Write SQL queries here (Ctrl/Cmd + Enter to run)\nSELECT name, type FROM sqlite_master WHERE type IN (\'table\', \'view\');'
  );
  const [sqlResults, setSqlResults] = useState<QueryExecResult[]>([]);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlMeta, setSqlMeta] = useState<string>('');

  // Confirmations
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [dropTableTarget, setDropTableTarget] = useState<string | null>(null);

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const refreshSize = useCallback(() => {
    if (!dbRef.current) return;
    try {
      setDbSizeBytes(dbRef.current.export().byteLength);
    } catch {
      // ignore
    }
  }, []);

  const refreshSchema = useCallback(
    (preferTable?: string) => {
      const db = dbRef.current;
      if (!db) return;

      const res = db.exec(
        "SELECT name, type, COALESCE(sql, '') as sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name;"
      );

      const list: TableSummary[] = [];
      if (res[0]) {
        for (const row of res[0].values) {
          const name = String(row[0]);
          const type = String(row[1]) as 'table' | 'view';
          const sql = String(row[2] || '');
          let rowCount = 0;
          try {
            const cnt = db.exec(`SELECT COUNT(*) FROM ${quoteIdent(name)};`);
            rowCount = Number(cnt[0]?.values?.[0]?.[0] || 0);
          } catch {
            rowCount = 0;
          }
          list.push({ name, type, sql, rowCount });
        }
      }

      setTables(list);
      refreshSize();

      const target =
        preferTable && list.some((t) => t.name === preferTable)
          ? preferTable
          : selectedTable && list.some((t) => t.name === selectedTable)
            ? selectedTable
            : list[0]?.name || '';
      setSelectedTable(target);
    },
    [refreshSize, selectedTable]
  );

  const loadTableData = useCallback(
    (tableName: string, targetPage = page, targetPageSize = pageSize) => {
      const db = dbRef.current;
      if (!db || !tableName) {
        setColumns([]);
        setRows([]);
        setRowIds([]);
        setTotalRows(0);
        return;
      }

      const infoRes = db.exec(`PRAGMA table_info(${quoteIdent(tableName)});`);
      const cols: ColumnInfo[] = (infoRes[0]?.values || []).map((v) => ({
        cid: Number(v[0]),
        name: String(v[1]),
        type: String(v[2] || 'TEXT'),
        notnull: Number(v[3]),
        dflt_value: v[4] === null ? null : String(v[4]),
        pk: Number(v[5]),
      }));
      setColumns(cols);

      let cnt = 0;
      try {
        const cntRes = db.exec(`SELECT COUNT(*) FROM ${quoteIdent(tableName)};`);
        cnt = Number(cntRes[0]?.values?.[0]?.[0] || 0);
      } catch {
        cnt = 0;
      }
      setTotalRows(cnt);

      const offset = targetPage * targetPageSize;
      try {
        // Attempt selecting rowid for reliable inline editing/deleting
        const dataRes = db.exec(
          `SELECT rowid AS __driveos_rowid__, * FROM ${quoteIdent(tableName)} LIMIT ${targetPageSize} OFFSET ${offset};`
        );
        setHasRowId(true);
        const r = dataRes[0];
        if (!r) {
          setRows([]);
          setRowIds([]);
          return;
        }
        const ids: number[] = [];
        const parsedRows: Record<string, unknown>[] = r.values.map((vals) => {
          ids.push(Number(vals[0]));
          const obj: Record<string, unknown> = {};
          for (let i = 1; i < r.columns.length; i++) {
            obj[r.columns[i]] = vals[i];
          }
          return obj;
        });
        setRowIds(ids);
        setRows(parsedRows);
      } catch {
        // WITHOUT ROWID tables or views
        setHasRowId(false);
        const dataRes = db.exec(
          `SELECT * FROM ${quoteIdent(tableName)} LIMIT ${targetPageSize} OFFSET ${offset};`
        );
        const r = dataRes[0];
        if (!r) {
          setRows([]);
          setRowIds([]);
          return;
        }
        const parsedRows: Record<string, unknown>[] = r.values.map((vals) => {
          const obj: Record<string, unknown> = {};
          for (let i = 0; i < r.columns.length; i++) {
            obj[r.columns[i]] = vals[i];
          }
          return obj;
        });
        setRowIds([]);
        setRows(parsedRows);
      }
    },
    [page, pageSize]
  );

  // Initialize SQLite DB (load from Drive or create empty)
  useEffect(() => {
    let active = true;
    setLoading(true);

    (async () => {
      try {
        const SQL = await getSqlJs();
        let db: SqlJsDatabase;
        if (file) {
          const blob = await storageProvider.downloadBlob(file.id);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          db = new SQL.Database(bytes);
        } else {
          db = new SQL.Database();
        }
        if (!active) {
          db.close();
          return;
        }
        dbRef.current?.close();
        dbRef.current = db;
        setDirty(!file);
        refreshSchema();
      } catch (err: any) {
        if (active) {
          toast.error(err?.message || 'Failed to load SQLite database');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      dbRef.current?.close();
      dbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  useEffect(() => {
    if (selectedTable) {
      loadTableData(selectedTable, page, pageSize);
    }
  }, [selectedTable, page, pageSize, loadTableData]);

  const filteredRows = useMemo(() => {
    const q = rowSearch.trim().toLowerCase();
    if (!q) return rows.map((r, i) => ({ row: r, rowid: rowIds[i] }));
    return rows
      .map((r, i) => ({ row: r, rowid: rowIds[i] }))
      .filter(({ row }) =>
        Object.values(row).some((v) => String(v ?? 'NULL').toLowerCase().includes(q))
      );
  }, [rowIds, rowSearch, rows]);

  const generatedCreateTableSql = useMemo(() => {
    const safeName = newTableName.trim() || 'new_table';
    const validCols = newTableCols.filter((c) => c.name.trim().length > 0);
    if (validCols.length === 0) return '';

    const colDefs = validCols.map((c) => {
      const parts = [quoteIdent(c.name.trim()), c.type];
      if (c.pk) {
        parts.push('PRIMARY KEY');
        if (c.autoincrement && c.type === 'INTEGER') parts.push('AUTOINCREMENT');
      }
      if (c.notNull && !c.pk) parts.push('NOT NULL');
      if (c.unique && !c.pk) parts.push('UNIQUE');
      if (c.defaultValue.trim()) {
        const def = c.defaultValue.trim();
        const isExpr =
          def.toUpperCase() === 'CURRENT_TIMESTAMP' ||
          def.toUpperCase() === 'NULL' ||
          !Number.isNaN(Number(def)) ||
          (def.startsWith("'") && def.endsWith("'"));
        parts.push(`DEFAULT ${isExpr ? def : `'${def.replace(/'/g, "''")}'`}`);
      }
      return `  ${parts.join(' ')}`;
    });

    return `CREATE TABLE ${quoteIdent(safeName)} (\n${colDefs.join(',\n')}\n);`;
  }, [newTableCols, newTableName]);

  const handleCreateTable = () => {
    const db = dbRef.current;
    if (!db || !generatedCreateTableSql) return;
    try {
      db.run(generatedCreateTableSql);
      const createdName = newTableName.trim();
      setDirty(true);
      setCreateTableOpen(false);
      setPage(0);
      refreshSchema(createdName);
      loadTableData(createdName, 0, pageSize);
      setActiveTab('browse');
      toast.success(`Table "${createdName}" created`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create table');
    }
  };

  const handleCreateStarterTemplate = () => {
    const db = dbRef.current;
    if (!db) return;
    try {
      db.run(`
        CREATE TABLE IF NOT EXISTS "items" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "name" TEXT NOT NULL,
          "category" TEXT DEFAULT 'general',
          "notes" TEXT,
          "created_at" TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO "items" ("name", "category", "notes") VALUES
          ('Welcome to SQLite Studio', 'guide', 'Hosted directly in Google Drive'),
          ('Sample Record', 'example', 'Click any row to edit or run SQL queries');
      `);
      setDirty(true);
      refreshSchema('items');
      loadTableData('items', 0, pageSize);
      toast.success('Created sample "items" table');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create sample table');
    }
  };

  const handleDropTable = () => {
    const db = dbRef.current;
    if (!db || !dropTableTarget) return;
    try {
      const summary = tables.find((t) => t.name === dropTableTarget);
      const kind = summary?.type === 'view' ? 'VIEW' : 'TABLE';
      db.run(`DROP ${kind} IF EXISTS ${quoteIdent(dropTableTarget)};`);
      setDirty(true);
      toast.success(`Dropped ${kind.toLowerCase()} "${dropTableTarget}"`);
      setDropTableTarget(null);
      setSelectedTable('');
      refreshSchema();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to drop table');
    }
  };

  const openInsertModal = () => {
    const initial: Record<string, { value: string; isNull: boolean }> = {};
    for (const c of columns) {
      initial[c.name] = {
        value: '',
        isNull: c.pk === 1 || c.notnull === 0,
      };
    }
    setInsertValues(initial);
    setInsertModalOpen(true);
  };

  const handleInsertRow = () => {
    const db = dbRef.current;
    if (!db || !selectedTable) return;
    try {
      const colNames: string[] = [];
      const values: unknown[] = [];

      for (const col of columns) {
        const entry = insertValues[col.name];
        if (!entry) continue;
        // Skip autoincrement PK if left empty/null so SQLite auto-assigns it
        if (col.pk === 1 && (entry.isNull || entry.value.trim() === '')) continue;
        colNames.push(quoteIdent(col.name));
        if (entry.isNull) {
          values.push(null);
        } else if (
          (col.type.toUpperCase().includes('INT') || col.type.toUpperCase().includes('REAL')) &&
          entry.value.trim() !== '' &&
          !Number.isNaN(Number(entry.value))
        ) {
          values.push(Number(entry.value));
        } else {
          values.push(entry.value);
        }
      }

      if (colNames.length === 0) {
        db.run(`INSERT INTO ${quoteIdent(selectedTable)} DEFAULT VALUES;`);
      } else {
        const placeholders = colNames.map(() => '?').join(', ');
        db.run(
          `INSERT INTO ${quoteIdent(selectedTable)} (${colNames.join(', ')}) VALUES (${placeholders});`,
          values as any
        );
      }

      setDirty(true);
      setInsertModalOpen(false);
      refreshSchema(selectedTable);
      loadTableData(selectedTable, page, pageSize);
      toast.success('Row inserted');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to insert row');
    }
  };

  const openEditRow = (row: Record<string, unknown>, rowid: number) => {
    const values: Record<string, { value: string; isNull: boolean }> = {};
    for (const col of columns) {
      const v = row[col.name];
      values[col.name] = {
        value: v === null || v === undefined ? '' : String(v),
        isNull: v === null || v === undefined,
      };
    }
    setEditingRow({ rowid, values });
  };

  const handleSaveRowEdit = () => {
    const db = dbRef.current;
    if (!db || !selectedTable || !editingRow) return;
    try {
      const setClauses: string[] = [];
      const params: unknown[] = [];
      for (const col of columns) {
        const entry = editingRow.values[col.name];
        if (!entry) continue;
        setClauses.push(`${quoteIdent(col.name)} = ?`);
        if (entry.isNull) {
          params.push(null);
        } else if (
          (col.type.toUpperCase().includes('INT') || col.type.toUpperCase().includes('REAL')) &&
          entry.value.trim() !== '' &&
          !Number.isNaN(Number(entry.value))
        ) {
          params.push(Number(entry.value));
        } else {
          params.push(entry.value);
        }
      }
      params.push(editingRow.rowid);
      db.run(
        `UPDATE ${quoteIdent(selectedTable)} SET ${setClauses.join(', ')} WHERE rowid = ?;`,
        params as any
      );
      setDirty(true);
      setEditingRow(null);
      refreshSchema(selectedTable);
      loadTableData(selectedTable, page, pageSize);
      toast.success('Row updated');
    } catch (err: any) {
      toast.error(err?.message || 'Update failed');
    }
  };

  const handleDeleteRow = () => {
    const db = dbRef.current;
    if (!db || !selectedTable || deleteRowTarget === null) return;
    try {
      db.run(`DELETE FROM ${quoteIdent(selectedTable)} WHERE rowid = ?;`, [deleteRowTarget]);
      setDirty(true);
      setDeleteRowTarget(null);
      refreshSchema(selectedTable);
      loadTableData(selectedTable, page, pageSize);
      toast.success('Row deleted');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete row');
    }
  };

  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault();
    const db = dbRef.current;
    if (!db || !selectedTable || !addColName.trim()) return;
    try {
      const defPart = addColDefault.trim()
        ? ` DEFAULT ${!Number.isNaN(Number(addColDefault)) ? addColDefault : `'${addColDefault.replace(/'/g, "''")}'`}`
        : '';
      db.run(
        `ALTER TABLE ${quoteIdent(selectedTable)} ADD COLUMN ${quoteIdent(addColName.trim())} ${addColType}${defPart};`
      );
      setDirty(true);
      setAddColName('');
      setAddColDefault('');
      refreshSchema(selectedTable);
      loadTableData(selectedTable, page, pageSize);
      toast.success('Column added');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add column');
    }
  };

  const handleRunSql = useCallback(() => {
    const db = dbRef.current;
    if (!db || !sqlInput.trim()) return;
    setSqlError(null);
    const t0 = performance.now();
    try {
      const results = db.exec(sqlInput);
      const elapsed = (performance.now() - t0).toFixed(1);
      const modified = db.getRowsModified();
      setSqlResults(results);
      setSqlMeta(
        `${results.length} result set(s) · ${modified} row(s) modified · ${elapsed} ms`
      );

      // Mark dirty if write keywords detected or rows modified
      const isWrite =
        modified > 0 ||
        /\b(create|alter|drop|insert|update|delete|replace|vacuum|pragma\s+\w+\s*=)\b/i.test(sqlInput);
      if (isWrite) {
        setDirty(true);
        refreshSchema();
        if (selectedTable) loadTableData(selectedTable, page, pageSize);
      }
    } catch (err: any) {
      setSqlError(err?.message || 'SQL execution failed');
      setSqlResults([]);
      setSqlMeta('');
    }
  }, [loadTableData, page, pageSize, refreshSchema, selectedTable, sqlInput]);

  const handleSaveToDrive = async () => {
    const db = dbRef.current;
    if (!db) return;
    setSaving(true);
    try {
      const normalizedName = /\.(sqlite|sqlite3|db)$/i.test(fileName.trim())
        ? fileName.trim()
        : `${fileName.trim() || 'database'}.sqlite`;
      setFileName(normalizedName);

      const bytes = db.export();
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/vnd.sqlite3' });
      setDbSizeBytes(bytes.byteLength);

      if (activeFile) {
        const updated = await storageProvider.updateFileContent(
          activeFile.id,
          blob,
          activeFile.mimeType || 'application/vnd.sqlite3'
        );
        setActiveFile(updated);
        toast.success(`Saved "${updated.name}" to Google Drive`);
      } else {
        const created = await storageProvider.uploadFile(
          blob,
          normalizedName,
          'application/vnd.sqlite3',
          targetFolderId || currentFolderId
        );
        setActiveFile(created);
        toast.success(`Created "${created.name}" in Google Drive`);
      }
      setDirty(false);
      triggerExplorerRefresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save SQLite database to Google Drive');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadLocal = () => {
    const db = dbRef.current;
    if (!db) return;
    const bytes = db.export();
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/vnd.sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.trim() || 'database.sqlite';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded SQLite file');
  };

  const handleExportTableCsv = () => {
    if (!selectedTable || columns.length === 0) return;
    const db = dbRef.current;
    if (!db) return;
    const res = db.exec(`SELECT * FROM ${quoteIdent(selectedTable)};`)[0];
    if (!res) return;
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [res.columns.map(esc).join(','), ...res.values.map((r) => r.map(esc).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTable}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSqlDump = () => {
    const db = dbRef.current;
    if (!db) return;
    const lines: string[] = ['BEGIN TRANSACTION;'];
    for (const t of tables) {
      if (t.sql) lines.push(`${t.sql};`);
      if (t.type === 'table') {
        const res = db.exec(`SELECT * FROM ${quoteIdent(t.name)};`)[0];
        if (res) {
          const colsList = res.columns.map(quoteIdent).join(', ');
          for (const row of res.values) {
            const vals = row.map(escapeSqlLiteral).join(', ');
            lines.push(`INSERT INTO ${quoteIdent(t.name)} (${colsList}) VALUES (${vals});`);
          }
        }
      }
    }
    lines.push('COMMIT;');
    const blob = new Blob([lines.join('\n')], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/\.(sqlite|sqlite3|db)$/i, '')}.sql`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported SQL dump');
  };

  const activeTableSummary = tables.find((t) => t.name === selectedTable) || null;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-11rem)] min-h-[540px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-800 dark:bg-[#14171F]">
        Loading SQLite WebAssembly engine &amp; database...
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F]">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileTablesOpen((v) => !v)}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 lg:hidden dark:border-slate-700 dark:text-slate-300"
            title="Toggle Tables"
          >
            <Table2 className="h-4 w-4" />
          </button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <Database className="h-4 w-4" />
          </div>
          <input
            value={fileName}
            disabled={Boolean(activeFile)}
            onChange={(e) => setFileName(e.target.value)}
            className="w-44 truncate rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 font-display text-sm font-semibold text-slate-900 focus:border-slate-300 focus:bg-slate-50 focus:outline-none disabled:opacity-90 dark:text-slate-100 dark:focus:border-slate-700 dark:focus:bg-slate-900"
          />
          <span className="hidden text-xs text-slate-500 tabular-nums sm:inline">
            {tables.length} table(s) · {formatBytes(dbSizeBytes)} ·{' '}
            {dirty ? 'Unsaved changes' : activeFile ? 'Synced with Google Drive' : 'New DB'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateTableOpen(true)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            New Table
          </button>

          <button
            type="button"
            onClick={handleDownloadLocal}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Download .sqlite</span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => (activeFile ? setConfirmSaveOpen(true) : handleSaveToDrive())}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : activeFile ? 'Save to Drive' : 'Create in Drive'}
          </button>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="relative flex min-h-0 flex-1">
        {/* Left Tables Sidebar */}
        <aside
          className={`${
            mobileTablesOpen ? 'absolute inset-y-0 left-0 z-20 flex shadow-xl' : 'hidden'
          } w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 lg:static lg:flex lg:shadow-none dark:border-slate-800 dark:bg-[#0F1218]`}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Schema ({tables.length})
            </span>
            <button
              type="button"
              onClick={() => refreshSchema()}
              title="Refresh schema"
              className="rounded p-1 text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {tables.length === 0 ? (
              <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
                <p>No tables yet.</p>
                <button
                  type="button"
                  onClick={() => setCreateTableOpen(true)}
                  className="w-full rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Create Table
                </button>
                <button
                  type="button"
                  onClick={handleCreateStarterTemplate}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Insert Sample Table
                </button>
              </div>
            ) : (
              tables.map((t) => {
                const isSelected = selectedTable === t.name;
                return (
                  <div
                    key={t.name}
                    className={`group flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition ${
                      isSelected
                        ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTable(t.name);
                        setPage(0);
                        setMobileTablesOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Table2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t.name}</span>
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                        {t.rowCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDropTableTarget(t.name)}
                        title={`Drop ${t.name}`}
                        className="rounded p-0.5 text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Tabs + Panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tab Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
              {(
                [
                  ['browse', 'Browse & Edit'],
                  ['sql', 'SQL Console'],
                  ['structure', 'Structure & Dump'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    activeTab === id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'browse' && selectedTable && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={rowSearch}
                    onChange={(e) => setRowSearch(e.target.value)}
                    placeholder="Filter rows..."
                    className="w-40 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-8 pr-2.5 text-xs focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                {activeTableSummary?.type === 'table' && (
                  <button
                    type="button"
                    onClick={openInsertModal}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Row
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExportTableCsv}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  CSV
                </button>
              </div>
            )}
          </div>

          {/* Tab Body */}
          {activeTab === 'browse' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {!selectedTable ? (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                  <Database className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                  <p className="mt-3 font-display text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Empty SQLite Database
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-slate-500">
                    Create a new table visually, insert a sample table, or run SQL statements in the SQL Console, then save directly to Google Drive.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateTableOpen(true)}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Create First Table
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateStarterTemplate}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                    >
                      Load Sample Table
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                        <tr>
                          {columns.map((col) => (
                            <th
                              key={col.name}
                              className="whitespace-nowrap border-r border-slate-200 px-3 py-2 font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200"
                            >
                              <span>{col.name}</span>
                              <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-400">
                                {col.type}
                                {col.pk ? ' PK' : ''}
                              </span>
                            </th>
                          ))}
                          {hasRowId && activeTableSummary?.type === 'table' && (
                            <th className="w-20 px-3 py-2 text-right font-medium text-slate-500">
                              Actions
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {filteredRows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={columns.length + 1}
                              className="px-4 py-10 text-center text-slate-500"
                            >
                              No rows in &ldquo;{selectedTable}&rdquo;.
                            </td>
                          </tr>
                        ) : (
                          filteredRows.map(({ row, rowid }, idx) => (
                            <tr
                              key={rowid ?? idx}
                              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                            >
                              {columns.map((col) => {
                                const val = row[col.name];
                                return (
                                  <td
                                    key={col.name}
                                    onClick={() =>
                                      hasRowId &&
                                      activeTableSummary?.type === 'table' &&
                                      openEditRow(row, rowid)
                                    }
                                    className={`max-w-[240px] truncate border-r border-slate-100 px-3 py-2 font-mono text-[11px] dark:border-slate-800/60 ${
                                      hasRowId && activeTableSummary?.type === 'table'
                                        ? 'cursor-pointer'
                                        : ''
                                    }`}
                                  >
                                    {val === null || val === undefined ? (
                                      <span className="italic text-slate-400">NULL</span>
                                    ) : val instanceof Uint8Array ? (
                                      <span className="text-indigo-500">
                                        BLOB ({val.byteLength} B)
                                      </span>
                                    ) : (
                                      String(val)
                                    )}
                                  </td>
                                );
                              })}
                              {hasRowId && activeTableSummary?.type === 'table' && (
                                <td className="px-3 py-1.5 text-right">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => openEditRow(row, rowid)}
                                      title="Edit row"
                                      className="rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-blue-600 dark:hover:bg-slate-700"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeleteRowTarget(rowid)}
                                      title="Delete row"
                                      className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
                    <span className="tabular-nums">
                      Total {totalRows} row(s) · Page {page + 1} of {totalPages}
                    </span>
                    <div className="flex items-center gap-2">
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(0);
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value={25}>25 / page</option>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                      </select>
                      <button
                        type="button"
                        disabled={page <= 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        className="rounded-lg border border-slate-200 p-1 disabled:opacity-40 dark:border-slate-700"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={page + 1 >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="rounded-lg border border-slate-200 p-1 disabled:opacity-40 dark:border-slate-700"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'sql' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {[
                    ['SELECT *', selectedTable ? `SELECT * FROM ${quoteIdent(selectedTable)} LIMIT 50;` : 'SELECT sqlite_version();'],
                    ['CREATE TABLE', 'CREATE TABLE example (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL\n);'],
                    ['INSERT', selectedTable ? `INSERT INTO ${quoteIdent(selectedTable)} DEFAULT VALUES;` : ''],
                    ['VACUUM', 'VACUUM;'],
                  ]
                    .filter(([, q]) => Boolean(q))
                    .map(([label, snippet]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setSqlInput(snippet)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {label}
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={handleRunSql}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run SQL
                </button>
              </div>

              <div
                className="h-48 shrink-0 overflow-auto border-b border-slate-200 dark:border-slate-800"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleRunSql();
                  }
                }}
              >
                <CodeMirror
                  value={sqlInput}
                  height="100%"
                  theme={isDark ? 'dark' : 'light'}
                  onChange={(val) => setSqlInput(val)}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-4">
                {sqlError && (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-mono text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    {sqlError}
                  </div>
                )}
                {sqlMeta && (
                  <p className="mb-3 text-xs font-medium text-slate-500 tabular-nums">{sqlMeta}</p>
                )}
                {sqlResults.map((res, idx) => (
                  <div
                    key={idx}
                    className="mb-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"
                  >
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                        <tr>
                          {res.columns.map((c) => (
                            <th key={c} className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {res.values.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => (
                              <td
                                key={cIdx}
                                className="max-w-[260px] truncate px-3 py-1.5 font-mono text-[11px]"
                              >
                                {cell === null ? (
                                  <span className="italic text-slate-400">NULL</span>
                                ) : (
                                  String(cell)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'structure' && (
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedTable ? `Structure: ${selectedTable}` : 'Database SQL Dump'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Inspect columns, append new columns, or export the full database as .sql.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportSqlDump}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export .sql Dump
                </button>
              </div>

              {selectedTable && (
                <>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Column</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Nullable</th>
                          <th className="px-3 py-2">Default</th>
                          <th className="px-3 py-2">Primary Key</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {columns.map((c) => (
                          <tr key={c.cid}>
                            <td className="px-3 py-2 font-mono text-slate-400">{c.cid}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-800 dark:text-slate-200">
                              {c.name}
                            </td>
                            <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400">
                              {c.type}
                            </td>
                            <td className="px-3 py-2">{c.notnull ? 'NO' : 'YES'}</td>
                            <td className="px-3 py-2 font-mono text-slate-500">
                              {c.dflt_value ?? '—'}
                            </td>
                            <td className="px-3 py-2">{c.pk ? 'PK' : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {activeTableSummary?.type === 'table' && (
                    <form
                      onSubmit={handleAddColumn}
                      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40"
                    >
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500">
                          New Column Name
                        </label>
                        <input
                          required
                          value={addColName}
                          onChange={(e) => setAddColName(e.target.value)}
                          placeholder="e.g. status"
                          className="mt-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500">Type</label>
                        <select
                          value={addColType}
                          onChange={(e) => setAddColType(e.target.value as any)}
                          className="mt-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="TEXT">TEXT</option>
                          <option value="INTEGER">INTEGER</option>
                          <option value="REAL">REAL</option>
                          <option value="NUMERIC">NUMERIC</option>
                          <option value="BLOB">BLOB</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500">
                          Default (optional)
                        </label>
                        <input
                          value={addColDefault}
                          onChange={(e) => setAddColDefault(e.target.value)}
                          placeholder="e.g. active"
                          className="mt-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Column
                      </button>
                    </form>
                  )}

                  {activeTableSummary?.sql && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-slate-500">DDL Statement</p>
                      <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                        {activeTableSummary.sql};
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Table Modal */}
      <Dialog.Root open={createTableOpen} onOpenChange={setCreateTableOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-[#14171F]">
            <div className="flex items-center justify-between">
              <Dialog.Title className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Create SQLite Table
              </Dialog.Title>
              <Dialog.Close className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Table Name
                </label>
                <input
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Columns
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setNewTableCols((prev) => [
                        ...prev,
                        {
                          name: `col_${prev.length + 1}`,
                          type: 'TEXT',
                          pk: false,
                          autoincrement: false,
                          notNull: false,
                          unique: false,
                          defaultValue: '',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-700"
                  >
                    <Plus className="h-3 w-3" /> Add Column
                  </button>
                </div>

                {newTableCols.map((col, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-12 sm:items-center dark:border-slate-800"
                  >
                    <input
                      value={col.name}
                      onChange={(e) =>
                        setNewTableCols((prev) =>
                          prev.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c))
                        )
                      }
                      placeholder="Column name"
                      className="sm:col-span-3 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <select
                      value={col.type}
                      onChange={(e) =>
                        setNewTableCols((prev) =>
                          prev.map((c, i) => (i === idx ? { ...c, type: e.target.value as any } : c))
                        )
                      }
                      className="sm:col-span-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="INTEGER">INTEGER</option>
                      <option value="TEXT">TEXT</option>
                      <option value="REAL">REAL</option>
                      <option value="NUMERIC">NUMERIC</option>
                      <option value="BLOB">BLOB</option>
                    </select>
                    <input
                      value={col.defaultValue}
                      onChange={(e) =>
                        setNewTableCols((prev) =>
                          prev.map((c, i) =>
                            i === idx ? { ...c, defaultValue: e.target.value } : c
                          )
                        )
                      }
                      placeholder="Default"
                      className="sm:col-span-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-[11px] sm:col-span-4">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={col.pk}
                          onChange={(e) =>
                            setNewTableCols((prev) =>
                              prev.map((c, i) =>
                                i === idx ? { ...c, pk: e.target.checked } : c
                              )
                            )
                          }
                        />
                        PK
                      </label>
                      {col.pk && col.type === 'INTEGER' && (
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={col.autoincrement}
                            onChange={(e) =>
                              setNewTableCols((prev) =>
                                prev.map((c, i) =>
                                  i === idx ? { ...c, autoincrement: e.target.checked } : c
                                )
                              )
                            }
                          />
                          AI
                        </label>
                      )}
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={col.notNull}
                          onChange={(e) =>
                            setNewTableCols((prev) =>
                              prev.map((c, i) =>
                                i === idx ? { ...c, notNull: e.target.checked } : c
                              )
                            )
                          }
                        />
                        NN
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={col.unique}
                          onChange={(e) =>
                            setNewTableCols((prev) =>
                              prev.map((c, i) =>
                                i === idx ? { ...c, unique: e.target.checked } : c
                              )
                            )
                          }
                        />
                        UQ
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setNewTableCols((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="justify-self-end rounded p-1 text-slate-400 hover:text-red-600 sm:col-span-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {generatedCreateTableSql && (
                <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {generatedCreateTableSql}
                </pre>
              )}

              <div className="flex justify-end gap-2">
                <Dialog.Close className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium dark:border-slate-700">
                  Cancel
                </Dialog.Close>
                <button
                  type="button"
                  disabled={!generatedCreateTableSql}
                  onClick={handleCreateTable}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Create Table
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Insert Row Modal */}
      <Dialog.Root open={insertModalOpen} onOpenChange={setInsertModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-[#14171F]">
            <Dialog.Title className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Insert Row into {selectedTable}
            </Dialog.Title>
            <div className="mt-4 space-y-3">
              {columns.map((col) => {
                const entry = insertValues[col.name] || { value: '', isNull: false };
                return (
                  <div key={col.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {col.name}{' '}
                        <span className="font-mono text-[10px] text-slate-400">
                          {col.type}
                          {col.pk ? ' PK' : ''}
                        </span>
                      </span>
                      <label className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                        <input
                          type="checkbox"
                          checked={entry.isNull}
                          onChange={(e) =>
                            setInsertValues((prev) => ({
                              ...prev,
                              [col.name]: { ...entry, isNull: e.target.checked },
                            }))
                          }
                        />
                        {col.pk ? 'Auto / NULL' : 'NULL'}
                      </label>
                    </div>
                    <input
                      disabled={entry.isNull}
                      value={entry.value}
                      onChange={(e) =>
                        setInsertValues((prev) => ({
                          ...prev,
                          [col.name]: { value: e.target.value, isNull: false },
                        }))
                      }
                      placeholder={col.dflt_value ? `Default: ${col.dflt_value}` : ''}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium dark:border-slate-700">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleInsertRow}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                Insert Row
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Edit Row Modal */}
      <Dialog.Root open={Boolean(editingRow)} onOpenChange={(o) => !o && setEditingRow(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-[#14171F]">
            <Dialog.Title className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Edit Row #{editingRow?.rowid}
            </Dialog.Title>
            <div className="mt-4 space-y-3">
              {editingRow &&
                columns.map((col) => {
                  const entry = editingRow.values[col.name] || { value: '', isNull: false };
                  return (
                    <div key={col.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {col.name}{' '}
                          <span className="font-mono text-[10px] text-slate-400">{col.type}</span>
                        </span>
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                          <input
                            type="checkbox"
                            checked={entry.isNull}
                            onChange={(e) =>
                              setEditingRow((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      values: {
                                        ...prev.values,
                                        [col.name]: { ...entry, isNull: e.target.checked },
                                      },
                                    }
                                  : null
                              )
                            }
                          />
                          NULL
                        </label>
                      </div>
                      <input
                        disabled={entry.isNull}
                        value={entry.value}
                        onChange={(e) =>
                          setEditingRow((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  values: {
                                    ...prev.values,
                                    [col.name]: { value: e.target.value, isNull: false },
                                  },
                                }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  );
                })}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium dark:border-slate-700">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleSaveRowEdit}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                Apply Change
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Confirm Overwrite on Google Drive */}
      <ConfirmDialog
        open={confirmSaveOpen}
        onOpenChange={setConfirmSaveOpen}
        title="Overwrite SQLite database in Google Drive?"
        description={`Save all schema and data edits back to "${activeFile?.name}" in Google Drive?`}
        confirmLabel="Save to Google Drive"
        loading={saving}
        onConfirm={async () => {
          setConfirmSaveOpen(false);
          await handleSaveToDrive();
        }}
      />

      {/* Confirm Drop Table */}
      <ConfirmDialog
        open={Boolean(dropTableTarget)}
        onOpenChange={(o) => !o && setDropTableTarget(null)}
        title={`Drop "${dropTableTarget}"?`}
        description="This permanently removes the table/view and its rows from the database. Save to Google Drive afterward to persist the change."
        confirmLabel="Drop"
        destructive
        onConfirm={handleDropTable}
      />

      {/* Confirm Delete Row */}
      <ConfirmDialog
        open={deleteRowTarget !== null}
        onOpenChange={(o) => !o && setDeleteRowTarget(null)}
        title="Delete row?"
        description={`Delete row #${deleteRowTarget} from "${selectedTable}"?`}
        confirmLabel="Delete Row"
        destructive
        onConfirm={handleDeleteRow}
      />
    </div>
  );
};
