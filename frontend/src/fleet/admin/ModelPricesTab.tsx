// Admin > Model prices (#117, its own page since #143). The prices come with the rest of the settings, so this page reads
// /settings and writes a price the same way the Settings page writes a switch.
import { AdminError, type AdminApi, type ModelPricesView, type PriceSet } from "./adminApi";
import { ModelPrices } from "./ModelPrices";
import { failText, useList } from "./useList";

export function ModelPricesTab({ api, onLocked }: { api: AdminApi; onLocked: () => void }) {
  const list = useList<{ modelPrices: ModelPricesView }>(api, "/settings", onLocked);
  /** A price change reports its refusal on its own row, so it hands the message back instead of showing a banner. */
  const put = async (body: object): Promise<string | null> => {
    try {
      await api("PUT", "/settings", body);
      list.reload();
      return null;
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) {
        onLocked();
        return null;
      }
      return failText(e);
    }
  };
  const actions = {
    save: (key: string, std: PriceSet, long: PriceSet | undefined) => put({ modelPrice: { key, std, ...(long ? { long } : {}) } }),
    reset: (key: string) => put({ resetModelPrice: key }),
  };
  return (
    <>
      {list.data?.modelPrices && <ModelPrices view={list.data.modelPrices} actions={actions} />}
      {list.error && (
        <div className="errbox" role="alert">
          Could not load the model prices ({list.error}).
        </div>
      )}
    </>
  );
}
