import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSchema,
  createSchemaCategory,
  deleteSchema,
  deleteSchemaCategory,
  fetchSchemaCategories,
  type SchemaCategoryPayload,
  type SchemaPayload,
  searchSchemas,
  updateSchema,
  updateSchemaCategory,
} from "../masterClient";

// ---- シェーマ(台紙画像)マスタ ----

const SCHEMA_CATEGORIES_KEY = ["master", "schema_categories"];
const SCHEMAS_KEY = ["master", "schemas"];

// カテゴリ全件。ツリーの組み立ては schemaCategoryTree.ts で行う。
export function useSchemaCategories() {
  return useQuery({
    queryKey: [...SCHEMA_CATEGORIES_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchSchemaCategories,
  });
}

export function useSchemaCategoryMutations() {
  const queryClient = useQueryClient();
  // カテゴリの削除・付け替えはシェーマ一覧のグループ分けにも効くので両方無効化する。
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: SCHEMA_CATEGORIES_KEY });
    queryClient.invalidateQueries({ queryKey: SCHEMAS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: SchemaCategoryPayload) => createSchemaCategory(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SchemaCategoryPayload }) =>
        updateSchemaCategory(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteSchemaCategory(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// カテゴリ内のシェーマ一覧(image は含まない)。null は未分類、undefined は全件。
export function useSchemas(categoryId: number | null | undefined, name?: string) {
  return useQuery({
    queryKey: [
      ...SCHEMAS_KEY,
      "list",
      { categoryId: categoryId === undefined ? "all" : (categoryId ?? "none"), name: name ?? "" },
    ],
    queryFn: () => searchSchemas({ category_id: categoryId, name: name || undefined, per: 100 }),
    placeholderData: keepPreviousData,
  });
}

export function useSchemaMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: SCHEMAS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: SchemaPayload) => createSchema(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SchemaPayload }) =>
        updateSchema(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteSchema(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
