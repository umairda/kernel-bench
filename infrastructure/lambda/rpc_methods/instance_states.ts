import { CPU_INSTANCE_ID, GPU_INSTANCE_ID, JsonRpcError, getState } from './shared'

export async function rpcInstanceStates() {
  try {
    const [cpu, gpu] = await Promise.all([getState(CPU_INSTANCE_ID), getState(GPU_INSTANCE_ID)])
    return { cpu, gpu }
  } catch (error: any) {
    throw new JsonRpcError(-32000, String(error?.message ?? error))
  }
}
