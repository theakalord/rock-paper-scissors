import { expect } from "chai";
import { ethers } from "hardhat";
import { utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { takeSnapshot, revertToSnapshot } from "./helpers/snapshot";
import {
  RPS,
  RPS__factory,
  MockLink,
  MockLink__factory,
  VRFCoordinatorMock,
  VRFCoordinatorMock__factory,
} from "../types";

describe("RPS", function () {
  let rps: RPS;
  let link: MockLink;
  let coordinator: VRFCoordinatorMock;
  let admin: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress;
  let snapshotId: number;

  const vrfKeyHash =
    "0x6c3699283bda56ad74f6b855546325b68d482e983852a7a82979cc4807b641f4";
  const vrfFee = "100000000000000000";

  before("Deploy", async function () {
    [admin, alice, bob] = await ethers.getSigners();

    link = await new MockLink__factory(admin).deploy();
    coordinator = await new VRFCoordinatorMock__factory(admin).deploy(
      link.address
    );
    rps = await new RPS__factory(admin).deploy(
      coordinator.address,
      link.address,
      vrfKeyHash,
      vrfFee
    );
  });

  beforeEach(async () => {
    snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
  });

  describe("Submit", function () {
    it("when LINK balance is not sufficient", async function () {
      await expect(
        rps.connect(alice).submit(0, { value: utils.parseEther("1") })
      ).to.be.revertedWithCustomError(rps, "InsufficientLink");
    });

    it("submit action and init game", async function () {
      await link.connect(admin).transfer(rps.address, utils.parseEther("100"));
      const action = 0;
      const bet = utils.parseEther("1");
      const gameId = rps
        .connect(alice)
        .callStatic.submit(action, { value: bet });
      const tx = rps.connect(alice).submit(action, { value: bet });
      await expect(tx)
        .to.emit(rps, "Submitted")
        .withArgs(alice.address, action, bet);

      const game = await rps.games(gameId);
      expect(game.player).to.be.eq(alice.address);
      expect(game.action).to.be.eq(action);
      expect(game.bet).to.be.eq(bet);
    });
  });

  describe("Fund", function () {
    it("when msg.value is 0", async function () {
      await expect(
        rps.connect(admin).fund({ value: 0 })
      ).to.be.revertedWithCustomError(rps, "InvalidAmount");
    });

    it("only owner can call", async function () {
      await expect(rps.connect(alice).fund({ value: 1 })).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("fund the contract", async function () {
      const fund = utils.parseEther("5");
      await rps.connect(admin).fund({ value: fund });
      expect(await ethers.provider.getBalance(rps.address)).to.be.eq(fund);
    });
  });

  describe("Choose Winner", function () {
    let gameId: string;
    const action = 0;
    const bet = utils.parseEther("1");

    beforeEach(async function () {
      await link.connect(admin).transfer(rps.address, utils.parseEther("100"));
      gameId = await rps
        .connect(alice)
        .callStatic.submit(action, { value: bet });
      await rps.connect(alice).submit(action, { value: bet });
    });

    describe("Player Win", function () {
      it("when reward balance is not enough", async function () {
        const fund = utils.parseEther("0.4");
        await rps.connect(admin).fund({ value: fund });

        const beforeBalance = await ethers.provider.getBalance(alice.address);

        const tx = await coordinator.callBackWithRandomness(
          gameId,
          5,
          rps.address
        );
        await expect(tx).to.emit(rps, "GameEnded").withArgs(gameId, 0);
        expect(await rps.claimable(alice.address)).to.be.eq(bet.sub(fund));

        expect(await ethers.provider.getBalance(alice.address)).to.be.eq(
          beforeBalance.add(bet).add(fund)
        );
      });

      it("when reward balance is enough", async function () {
        await rps.connect(admin).fund({ value: utils.parseEther("5") });

        const beforeBalance = await ethers.provider.getBalance(alice.address);

        const tx = await coordinator.callBackWithRandomness(
          gameId,
          5,
          rps.address
        );
        await expect(tx).to.emit(rps, "GameEnded").withArgs(gameId, 0);
        expect(await rps.claimable(alice.address)).to.be.eq(0);

        expect(await ethers.provider.getBalance(alice.address)).to.be.eq(
          beforeBalance.add(bet.mul(2))
        );
      });
    });

    describe("Player Draw", function () {
      it("when reward balance is not enough", async function () {
        // bob place bet
        const gameId2 = await rps
          .connect(bob)
          .callStatic.submit(action, { value: bet });
        await rps.connect(bob).submit(action, { value: bet });
        await coordinator.callBackWithRandomness(gameId2, 5, rps.address);

        expect(await ethers.provider.getBalance(rps.address)).to.be.eq(0);

        const beforeBalance = await ethers.provider.getBalance(alice.address);

        const tx = await coordinator.callBackWithRandomness(
          gameId,
          3,
          rps.address
        );
        await expect(tx).to.emit(rps, "GameEnded").withArgs(gameId, 2);
        expect(await rps.claimable(alice.address)).to.be.eq(bet);

        expect(await ethers.provider.getBalance(alice.address)).to.be.eq(
          beforeBalance
        );
      });

      it("when reward balance is enough", async function () {
        const beforeBalance = await ethers.provider.getBalance(alice.address);

        const tx = await coordinator.callBackWithRandomness(
          gameId,
          3,
          rps.address
        );
        await expect(tx).to.emit(rps, "GameEnded").withArgs(gameId, 2);
        expect(await rps.claimable(alice.address)).to.be.eq(0);

        expect(await ethers.provider.getBalance(alice.address)).to.be.eq(
          beforeBalance.add(bet)
        );
      });
    });

    it("Player Lose", async function () {
      const tx = await coordinator.callBackWithRandomness(
        gameId,
        4,
        rps.address
      );
      await expect(tx).to.emit(rps, "GameEnded").withArgs(gameId, 1);
    });
  });

  describe("Claim", function () {
    let gameId: string;
    const action = 0;
    const bet = utils.parseEther("2");

    beforeEach(async function () {
      await link.connect(admin).transfer(rps.address, utils.parseEther("100"));
      gameId = await rps
        .connect(alice)
        .callStatic.submit(action, { value: bet });
      await rps.connect(alice).submit(action, { value: bet });
      await coordinator.callBackWithRandomness(gameId, 5, rps.address);
      expect(await rps.claimable(alice.address)).to.be.eq(bet);
    });

    it("cannot claim more than claimable", async function () {
      const amount = bet.add(1);
      await expect(rps.connect(alice).claim(amount))
        .to.be.revertedWithCustomError(rps, "InsufficientClaimable")
        .withArgs(amount);
    });

    it("when balance is not enough", async function () {
      const amount = bet;
      await expect(
        rps.connect(alice).claim(amount)
      ).to.be.revertedWithCustomError(rps, "InsufficientBalance");
    });

    it("claim amount", async function () {
      await rps.connect(admin).fund({ value: bet });

      const amount = bet.div(3);
      const tx = await rps.connect(alice).claim(amount);
      await expect(tx).to.emit(rps, "Claimed").withArgs(amount);

      expect(await rps.claimable(alice.address)).to.be.eq(bet.sub(amount));
    });
  });
});
