import Crypto from "node:crypto";
import { NodeId } from "@chainsafe/enr";

import { generateKeypair, IKeypair, createKeypair } from "../keypair/index.js";
import { fromHex, toBuffer } from "../util/index.js";
import { getDiscv5Crypto } from "../util/crypto.js";

// Implementation for generating session keys in the Discv5 protocol.
// Currently, Diffie-Hellman key agreement is performed with known public key types. Session keys
// are then derived using the HKDF (SHA2-256) key derivation function.
//
// There is no abstraction in this module as the specification explicitly defines a singular
// encryption and key-derivation algorithms. Future versions may abstract some of these to allow
// for different algorithms.

const KEY_AGREEMENT_STRING = "discovery v5 key agreement";
const ID_SIGNATURE_TEXT = "discovery v5 identity proof";
const KEY_LENGTH = 16;
export const MAC_LENGTH = 16;

// Generates session keys for a challengeData and remote ENR. This currently only
// supports Secp256k1 signed ENR's.
// Returns [initiatorKey, responderKey, ephemPK]
export function generateSessionKeys(
  localId: NodeId,
  remoteId: NodeId,
  remotePubkey: IKeypair,
  challengeData: Buffer
): [Buffer, Buffer, Buffer] {
  const ephemKeypair = generateKeypair(remotePubkey.type);
  const secret = ephemKeypair.deriveSecret(remotePubkey);
  /* TODO possibly not needed, check tests
  const ephemPubkey =
    remoteKeypair.type === "secp256k1"
      ? secp256k1PublicKeyToCompressed(ephemKeypair.publicKey)
      : ephemKeypair.publicKey;
  */
  return [...deriveKey(secret, localId, remoteId, challengeData), ephemKeypair.publicKey] as [Buffer, Buffer, Buffer];
}

export function deriveKey(secret: Buffer, firstId: NodeId, secondId: NodeId, challengeData: Buffer): [Buffer, Buffer] {
  const info = Buffer.concat([Buffer.from(KEY_AGREEMENT_STRING), fromHex(firstId), fromHex(secondId)]);
  const output = toBuffer(getDiscv5Crypto().hkdf.expand(getDiscv5Crypto().sha256, getDiscv5Crypto().hkdf.extract(getDiscv5Crypto().sha256, secret, challengeData), info, 2 * KEY_LENGTH));
  return [output.slice(0, KEY_LENGTH), output.slice(KEY_LENGTH, 2 * KEY_LENGTH)];
}

export function deriveKeysFromPubkey(
  kpriv: IKeypair,
  localId: NodeId,
  remoteId: NodeId,
  ephemPK: Buffer,
  challengeData: Buffer
): [Buffer, Buffer] {
  const secret = kpriv.deriveSecret(createKeypair({ type: kpriv.type, publicKey: ephemPK }));
  return deriveKey(secret, remoteId, localId, challengeData);
}

// Generates a signature given a keypair.
export function idSign(kpriv: IKeypair, challengeData: Buffer, ephemPK: Buffer, destNodeId: NodeId): Buffer {
  const signingNonce = generateIdSignatureInput(challengeData, ephemPK, destNodeId);
  return kpriv.sign(signingNonce);
}

// Verifies the id signature
export function idVerify(
  kpub: IKeypair,
  challengeData: Buffer,
  remoteEphemPK: Buffer,
  srcNodeId: NodeId,
  sig: Buffer
): boolean {
  const signingNonce = generateIdSignatureInput(challengeData, remoteEphemPK, srcNodeId);
  return kpub.verify(signingNonce, sig);
}

export function generateIdSignatureInput(challengeData: Buffer, ephemPK: Buffer, nodeId: NodeId): Buffer {
  return toBuffer(getDiscv5Crypto().sha256(Buffer.concat([Buffer.from(ID_SIGNATURE_TEXT), challengeData, ephemPK, fromHex(nodeId)])));
}

export function decryptMessage(key: Buffer, nonce: Buffer, data: Buffer, aad: Buffer): Buffer {
  if (data.length < MAC_LENGTH) {
    throw new Error("message data not long enough");
  }
  const ctx = Crypto.createDecipheriv("aes-128-gcm", key, nonce);
  ctx.setAAD(aad);
  ctx.setAuthTag(data.slice(data.length - MAC_LENGTH));
  return Buffer.concat([
    ctx.update(data.slice(0, data.length - MAC_LENGTH)), // remove appended mac
    ctx.final(),
  ]);
}

export function encryptMessage(key: Buffer, nonce: Buffer, data: Buffer, aad: Buffer): Buffer {
  const ctx = Crypto.createCipheriv("aes-128-gcm", key, nonce);
  ctx.setAAD(aad);
  return Buffer.concat([
    ctx.update(data),
    ctx.final(),
    ctx.getAuthTag(), // append mac
  ]);
}
