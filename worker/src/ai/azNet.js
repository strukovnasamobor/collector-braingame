// ONNX session wrapper for AlphaZero ValuePolicyNet inference.
//
// This file is the only place onnxruntime is imported — when migrating to
// the Cloudflare Worker, swap `onnxruntime-node` → `onnxruntime-web` and the
// rest of the AZ code stays untouched.

import * as ort from 'onnxruntime-node';
import { IN_PLANES, SIZE } from './azEncoder.js';

export class AzNet {
  constructor(session, size = SIZE) {
    this.session = session;
    this.size = size;
  }

  static async loadFromFile(modelPath) {
    const session = await ort.InferenceSession.create(modelPath);
    return new AzNet(session);
  }

  /**
   * Batched inference.
   * @param {Float32Array} batchPlanes  shape (B * IN_PLANES * size * size), C-order
   * @param {number} batchSize          B
   * @returns {Promise<{policyLogits: Float32Array, values: Float32Array}>}
   *   policyLogits: length B * size*size (row b is logits b)
   *   values:       length B
   */
  async forward(batchPlanes, batchSize) {
    const tensor = new ort.Tensor('float32', batchPlanes,
      [batchSize, IN_PLANES, this.size, this.size]);
    const outputs = await this.session.run({ state: tensor });
    return {
      policyLogits: outputs.policy_logits.data,
      values:       outputs.value.data,
    };
  }
}
