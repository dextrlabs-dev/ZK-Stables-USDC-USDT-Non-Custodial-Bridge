import React from 'react';
import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useZkStables } from '../hooks/useZkStables.js';

export const TxLog: React.FC = () => {
  const { txLog } = useZkStables();

  return (
    <Card id="panel-tx-log" variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Transaction log
        </Typography>
        {txLog.length === 0 ? (
          <Typography color="text.secondary">No transactions yet.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Step</TableCell>
                <TableCell>txId</TableCell>
                <TableCell>txHash</TableCell>
                <TableCell>block</TableCell>
                <TableCell>time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {txLog.map((row) => (
                <TableRow key={`${row.label}-${row.txId}-${row.at}`}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, maxWidth: 160, wordBreak: 'break-all' }}>
                    {row.txId}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, maxWidth: 160, wordBreak: 'break-all' }}>
                    {row.txHash}
                  </TableCell>
                  <TableCell>{row.blockHeight?.toString() ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>{row.at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
