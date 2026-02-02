const { expect } = require('chai');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const { ethers } = require('hardhat');

describe('MerkleProof matches merkletreejs', () => {
  it('verifies', async () => {
    const leaves = [
      Buffer.from('01'.repeat(32), 'hex'),
      Buffer.from('02'.repeat(32), 'hex'),
      Buffer.from('03'.repeat(32), 'hex'),
    ];
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true, hashLeaves: false });
    const root = '0x' + tree.getRoot().toString('hex');
    const idx = 1;
    const leaf = '0x' + leaves[idx].toString('hex');
    const proof = tree.getProof(leaves[idx]).map((p) => '0x' + p.data.toString('hex'));

    const Verifier = await ethers.getContractFactory('MerkleVerifyHarness');
    const v = await Verifier.deploy();
    await v.waitForDeployment();

    const ok = await v.verify(proof, root, leaf);
    expect(ok).to.equal(true);
  });
});
