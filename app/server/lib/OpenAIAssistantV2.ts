import {
  AssistanceResponseV2,
} from "app/common/Assistance";
import { AssistantProvider } from "app/common/Assistant";
import {
  getProviderFromHostname,
} from "app/server/lib/Assistant";
import { makeExceptionalDocSession, OptDocSession } from "app/server/lib/DocSession";
import {
  AssistanceDoc,
  AssistantV2,
  AssistantV2Options,
} from "app/server/lib/IAssistant";
import log from "app/server/lib/log";
import { agents } from "app/server/lib/ProxyAgent";

import fetch from "node-fetch";

const TOOLS_DEFINITION = [
  {
    type: "function" as const,
    function: {
      name: "get_schema",
      description: "Retrieve the current database schema, including all tables, " +
        "columns (ID, Grist type, display label, and formula), and the current document access rules.",
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_table",
      description: "Create a new table with the given table ID and columns. " +
        "Automatically creates a page/view for this table so it appears in the UI.",
      parameters: {
        type: "object",
        properties: {
          table_id: { type: "string", description: "The unique ID of the table to create (e.g. 'Customers')" },
          columns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Column ID (e.g. 'First_Name')" },
                type: {
                  type: "string",
                  description: "Grist type: 'Text', 'Numeric', 'Int', 'Bool', 'Date', 'DateTime', 'Choice'",
                },
                label: { type: "string", description: "Display label for the column (optional)" },
              },
              required: ["id", "type"],
            },
          },
        },
        required: ["table_id", "columns"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_columns",
      description: "Add new columns to an existing table.",
      parameters: {
        type: "object",
        properties: {
          table_id: { type: "string", description: "The ID of the table to modify" },
          columns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Column ID (e.g. 'Age')" },
                type: {
                  type: "string",
                  description: "Grist type: 'Text', 'Numeric', 'Int', 'Bool', 'Date', 'DateTime', 'Choice'",
                },
                label: { type: "string", description: "Display label (optional)" },
              },
              required: ["id", "type"],
            },
          },
        },
        required: ["table_id", "columns"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_records",
      description: "Add new records/rows of data to an existing table.",
      parameters: {
        type: "object",
        properties: {
          table_id: { type: "string", description: "The ID of the table" },
          records: {
            type: "array",
            items: {
              type: "object",
              description: "Key-value pairs matching column IDs and their values",
            },
          },
        },
        required: ["table_id", "records"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_records",
      description: "Update fields for specific records in a table by their row IDs.",
      parameters: {
        type: "object",
        properties: {
          table_id: { type: "string", description: "The ID of the table" },
          records: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer", description: "The row ID of the record to update" },
                fields: { type: "object", description: "Fields to update and their values" },
              },
              required: ["id", "fields"],
            },
          },
        },
        required: ["table_id", "records"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_records",
      description: "Delete records from a table by their row IDs.",
      parameters: {
        type: "object",
        properties: {
          table_id: { type: "string", description: "The ID of the table" },
          record_ids: {
            type: "array",
            items: { type: "integer" },
          },
        },
        required: ["table_id", "record_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_column_style",
      description: "Modify font/color/alignment style of a column. Can set cell text/background color and alignment.",
      parameters: {
        type: "object",
        properties: {
          table_id: { type: "string", description: "The ID of the table" },
          col_id: { type: "string", description: "The column ID" },
          style: {
            type: "object",
            properties: {
              textColor: { type: "string", description: "Hex color code for text (e.g. '#FF0000')" },
              fillColor: { type: "string", description: "Hex color code for cell background (e.g. '#EAF2F8')" },
              fontBold: { type: "boolean" },
              fontItalic: { type: "boolean" },
              fontUnderline: { type: "boolean" },
              alignment: { type: "string", enum: ["left", "center", "right"] },
            },
          },
        },
        required: ["table_id", "col_id", "style"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_column_formula",
      description: "Set a python formula for a column in a table.",
      parameters: {
        type: "object",
        properties: {
          table_id: { type: "string", description: "The ID of the table" },
          col_id: { type: "string", description: "The column ID to set formula on" },
          formula: { type: "string", description: "The Python formula string (e.g. '$Price * $Quantity')" },
        },
        required: ["table_id", "col_id", "formula"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "apply_actions",
      description: "Apply arbitrary Grist user actions. Use this only if other specialized tools do not fit the task.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: { type: "array", description: "A Grist action tuple" },
          },
        },
        required: ["actions"],
      },
    },
  },
];

export class OpenAIAssistantV2 implements AssistantV2 {
  public static readonly VERSION = 2;
  public static readonly DEFAULT_MODEL = "gpt-4o-2024-08-06";

  private _apiKey = this._options.apiKey;
  private _endpoint =
    this._options.completionEndpoint ??
    "https://api.openai.com/v1/chat/completions";

  private _model = this._options.model || OpenAIAssistantV2.DEFAULT_MODEL;

  public constructor(private _options: AssistantV2Options) {}

  public get version(): 2 {
    return OpenAIAssistantV2.VERSION;
  }

  public get provider(): AssistantProvider {
    return getProviderFromHostname(this._endpoint);
  }

  public async getAssistance(
    optSession: OptDocSession,
    doc: AssistanceDoc,
    request: any,
  ): Promise<AssistanceResponseV2> {
    const messages: any[] = [...(request.state?.messages || [])];
    const userText = request.text;

    // Use custom settings from client if provided
    const apiKey = request.apiKey || this._apiKey;
    const model = request.model || this._model;
    let endpoint = this._endpoint;
    if (request.baseUrl) {
      endpoint = request.baseUrl;
      if (!endpoint.endsWith("/chat/completions") && !endpoint.endsWith("/completions")) {
        endpoint = endpoint.replace(/\/+$/, "") + "/chat/completions";
      }
    }

    if (!apiKey && endpoint.includes("api.openai.com")) {
      throw new Error("API Key is required to connect to OpenAI.");
    }

    // Initialize system prompt if needed
    if (messages.length === 0 || !messages.some(m => m.role === "system")) {
      let systemPrompt = `You are a helpful AI Assistant for Grist, a modern collaborative spreadsheet database.
You help users build tables, structure databases, format/style columns, write python formulas, explain access rules, and modify/query document data.
Strictly enforce scoping: all operations you execute will apply ONLY to the current document. You cannot access or modify other documents or workspaces outside of this document.

Capabilities & How Grist Works:
1. Formulas: Grist uses Python for formulas. You can set column-wide formulas using set_column_formula.
2. Styling: You can format column values, set text/fill colors, bold/italic, alignment using set_column_style.
3. Access Rules: You can inspect access rules via get_schema. Explain them clearly if asked.
4. Tables: You can create a new table with columns using create_table. It will automatically add a view page for it.
5. Modifying Data: You can add records, update records, and delete records in a table using their respective tools.

Before answering any questions about the database structure, tables, columns, or rules, or before performing modifications on existing tables, ALWAYS call get_schema first to see the current state.`;

      // If we are in the context of the formula editor, append formula context
      if (request.context?.tableId && request.context.colId) {
        systemPrompt += `\n\nCURRENT CONTEXT: You are currently helping write a Python formula for the column '${request.context.colId}' in table '${request.context.tableId}'.
Your response should focus on generating the correct Python formula. Explain it clearly and use the set_column_formula tool if the user requests applying it, or explain the formula body.`;
      }

      messages.unshift({
        role: "system",
        content: systemPrompt,
      });
    }

    if (userText) {
      messages.push({
        role: "user",
        content: userText,
      });
    }

    let loopCount = 0;
    let reply = "";

    while (loopCount < 5) {
      loopCount++;

      const payload = {
        model,
        messages,
        temperature: 0,
        tools: TOOLS_DEFINITION,
        tool_choice: "auto",
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...(apiKey ? {
            "Authorization": `Bearer ${apiKey}`,
            "api-key": apiKey,
          } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        ...(agents.trusted ? { agent: agents.trusted } : {}),
      });

      if (res.status !== 200) {
        const errorText = await res.text();
        throw new Error(`OpenAI API returned status ${res.status}: ${errorText}`);
      }

      const responseData = await res.json();
      const choice = responseData.choices[0];
      const assistantMessage = choice.message;

      messages.push(assistantMessage);

      if (assistantMessage.content) {
        reply = assistantMessage.content;
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const name = toolCall.function.name;
          let args: any = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            log.error(`Failed to parse tool call arguments: ${toolCall.function.arguments}`);
          }

          let toolResult: any;

          try {
            log.info(`Assistant V2 calling tool: ${name}`, args);
            if (name === "get_schema") {
              toolResult = await handleGetSchema(doc);
            } else if (name === "create_table") {
              toolResult = await handleCreateTable(doc, optSession, args.table_id, args.columns);
            } else if (name === "add_columns") {
              toolResult = await handleAddColumns(doc, optSession, args.table_id, args.columns);
            } else if (name === "add_records") {
              toolResult = await handleAddRecords(doc, optSession, args.table_id, args.records);
            } else if (name === "update_records") {
              toolResult = await handleUpdateRecords(doc, optSession, args.table_id, args.records);
            } else if (name === "delete_records") {
              toolResult = await handleDeleteRecords(doc, optSession, args.table_id, args.record_ids);
            } else if (name === "set_column_style") {
              toolResult = await handleSetColumnStyle(doc, optSession, args.table_id, args.col_id, args.style);
            } else if (name === "set_column_formula") {
              toolResult = await handleSetColumnFormula(doc, optSession, args.table_id, args.col_id, args.formula);
            } else if (name === "apply_actions") {
              toolResult = await doc.applyUserActions(optSession, args.actions);
            } else {
              toolResult = { error: `Unknown tool: ${name}` };
            }
          } catch (e: any) {
            log.error(`Tool execution error: ${e.message || e}`);
            toolResult = { error: e.message || String(e) };
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: name,
            content: JSON.stringify(toolResult),
          });
        }
      } else {
        // No tool calls, we have the final reply
        break;
      }
    }

    return {
      reply,
      state: { messages },
    };
  }
}

async function fetchMetadata(doc: AssistanceDoc, tableId: string) {
  try {
    const res = await doc.fetchTable(makeExceptionalDocSession("system"), tableId);
    const [, , rowIds, colValues] = res.tableData;
    const records: any[] = [];
    for (let i = 0; i < rowIds.length; i++) {
      const rec: any = { id: rowIds[i] };
      for (const [colId, values] of Object.entries(colValues)) {
        rec[colId] = (values as any)[i];
      }
      records.push(rec);
    }
    return records;
  } catch (e) {
    return [];
  }
}

async function handleGetSchema(doc: AssistanceDoc) {
  const tables = await fetchMetadata(doc, "_grist_Tables");
  const columns = await fetchMetadata(doc, "_grist_Tables_column");
  const views = await fetchMetadata(doc, "_grist_Views");
  const aclRules = await fetchMetadata(doc, "_grist_ACLRules");

  const formattedTables = tables.map((t) => {
    const tableCols = columns
      .filter(c => c.parentId === t.id)
      .map((c) => {
        let widgetOptions: any = {};
        try {
          widgetOptions = c.widgetOptions ? JSON.parse(c.widgetOptions) : {};
        } catch (e) {
          // ignore parsing error
        }
        return {
          id: c.colId,
          type: c.type,
          label: c.label,
          formula: c.formula || "",
          widgetOptions,
        };
      });
    return {
      id: t.tableId,
      columns: tableCols,
    };
  });

  return {
    tables: formattedTables,
    views: views.map(v => ({ id: v.id, name: v.name })),
    access_rules: aclRules.map(r => ({
      id: r.id,
      tableId: r.tableId,
      colIds: r.colIds,
      permissions: r.permissions,
      principals: r.principals,
      conditions: r.conditions,
    })),
  };
}

async function handleCreateTable(doc: AssistanceDoc, session: OptDocSession, tableId: string, columns: any[]) {
  const colSpecs = columns.map(c => ({
    id: c.id,
    type: c.type,
    label: c.label || c.id,
  }));
  const result = await doc.applyUserActions(session, [
    ["AddTable", tableId, colSpecs],
    ["AddView", tableId, "raw_data", tableId],
  ]);
  return { success: true, result };
}

async function handleAddColumns(doc: AssistanceDoc, session: OptDocSession, tableId: string, columns: any[]) {
  const actions = columns.map(c => [
    "AddColumn",
    tableId,
    c.id,
    { type: c.type, label: c.label || c.id },
  ]);
  const result = await doc.applyUserActions(session, actions);
  return { success: true, result };
}

async function handleAddRecords(doc: AssistanceDoc, session: OptDocSession, tableId: string, records: any[]) {
  const actions = records.map(r => [
    "AddRecord",
    tableId,
    null,
    r,
  ]);
  const result = await doc.applyUserActions(session, actions);
  return { success: true, result };
}

async function handleUpdateRecords(doc: AssistanceDoc, session: OptDocSession, tableId: string, records: any[]) {
  const actions = records.map(r => [
    "UpdateRecord",
    tableId,
    r.id,
    r.fields,
  ]);
  const result = await doc.applyUserActions(session, actions);
  return { success: true, result };
}

async function handleDeleteRecords(doc: AssistanceDoc, session: OptDocSession, tableId: string, recordIds: any[]) {
  const actions = recordIds.map(id => [
    "RemoveRecord",
    tableId,
    id,
  ]);
  const result = await doc.applyUserActions(session, actions);
  return { success: true, result };
}

async function handleSetColumnFormula(
  doc: AssistanceDoc,
  session: OptDocSession,
  tableId: string,
  colId: string,
  formula: string,
) {
  const action = [
    "ModifyColumn",
    tableId,
    colId,
    { isFormula: true, formula },
  ];
  const result = await doc.applyUserActions(session, [action]);
  return { success: true, result };
}

async function handleSetColumnStyle(
  doc: AssistanceDoc,
  session: OptDocSession,
  tableId: string,
  colId: string,
  style: any,
) {
  const tables = await fetchMetadata(doc, "_grist_Tables");
  const targetTable = tables.find(t => t.tableId === tableId);
  if (!targetTable) {
    throw new Error(`Table ${tableId} not found`);
  }

  const columns = await fetchMetadata(doc, "_grist_Tables_column");
  const targetCol = columns.find(c => c.parentId === targetTable.id && c.colId === colId);
  if (!targetCol) {
    throw new Error(`Column ${colId} not found in table ${tableId}`);
  }

  let widgetOptions: any = {};
  if (targetCol.widgetOptions) {
    try {
      widgetOptions = JSON.parse(targetCol.widgetOptions);
    } catch (e) {
      // ignore parsing error
    }
  }

  const mergedStyle = {
    ...widgetOptions,
    ...style,
  };

  const action = [
    "ModifyColumn",
    tableId,
    colId,
    { widgetOptions: JSON.stringify(mergedStyle) },
  ];

  const result = await doc.applyUserActions(session, [action]);
  return { success: true, result };
}
