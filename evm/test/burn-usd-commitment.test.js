const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ZkStablesWrappedToken burn (zkUSDC / zkUSDT) + burnCommitment', () => {
  it('mints zkUSDC via bridge then burn emits Burned with burnCommitment', async () => {
    const [, user] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory('BridgeVerifierMock');
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    const BridgeMint = await ethers.getContractFactory('ZkStablesBridgeMint');
    const bridgeMint = await BridgeMint.deploy(await verifier.getAddress());
    await bridgeMint.waitForDeployment();

    const Wrapped = await ethers.getContractFactory('ZkStablesWrappedToken');
    const wUSDC = await Wrapped.deploy('ZK USDC', 'zkUSDC', 6, await bridgeMint.getAddress());
    await wUSDC.waitForDeployment();

    const mintNonce = ethers.id('mint-nonce-test');
    await (
      await bridgeMint.mintWrapped(
        await wUSDC.getAddress(),
        user.address,
        100_000n,
        mintNonce,
        '0x',
        ethers.ZeroHash,
      )
    ).wait();

    const burnNonce = ethers.id('burn-nonce-test');
    const burnCommitment = ethers.id('midnight-burn-binding');
    await expect(wUSDC.connect(user).burn(50_000n, user.address, burnNonce, burnCommitment))
      .to.emit(wUSDC, 'Burned')
      .withArgs(user.address, user.address, 50_000n, burnNonce, burnCommitment);
  });
});
