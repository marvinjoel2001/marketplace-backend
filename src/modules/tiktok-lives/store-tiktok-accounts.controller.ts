import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, SessionUser, UserGuard, ownedStore } from '../auth/user.guard';
import { StoreTikTokAccountsService } from './store-tiktok-accounts.service';
import { TikTokLivesWorker } from './tiktok-lives.worker';

/** The store owner's TikTok accounts: a live on any of them shows the store's products. */
@Controller('stores/:storeId/tiktok-accounts')
@UseGuards(UserGuard)
export class StoreTikTokAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: StoreTikTokAccountsService,
    private readonly worker: TikTokLivesWorker,
  ) {}

  @Get()
  async list(@Param('storeId') storeId: string, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.accounts.list(store.id);
  }

  @Post()
  async add(@Param('storeId') storeId: string, @Body('username') username: unknown, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    const list = await this.accounts.add(store.id, username);
    this.worker.checkStore(store.id); // It may already be broadcasting.
    return list;
  }

  @Patch(':username')
  async rename(
    @Param('storeId') storeId: string,
    @Param('username') current: string,
    @Body('username') username: unknown,
    @CurrentUser() user: SessionUser,
  ) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    const list = await this.accounts.rename(store.id, current, username);
    this.worker.checkStore(store.id);
    return list;
  }

  @Delete(':username')
  async remove(@Param('storeId') storeId: string, @Param('username') username: string, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.accounts.remove(store.id, username);
  }
}
